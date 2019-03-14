const assert = require('assert')
const isEqual = require('lodash.isequal');
const db = require('../../db')
const { persistAndPropagate } = require('./lib/propagation')
const { getBalancesAfterFeesTree } = require('./lib/fees')
const { isValidRootHash, toBNMap, toBNStringMap } = require('./lib')
const { isValidTransition, isHealthy } = require('./lib/followerRules')
const producer = require('./producer')
const { heartbeatIfNothingNew } = require('./heartbeat')

function tick(adapter, channel) {
	// @TODO: there's a flaw if we use this in a more-than-two validator setup
	// SEE https://github.com/AdExNetwork/adex-validator-stack-js/issues/4
	return Promise.all([
		getLatestMsg(channel.id, channel.validators[0], 'NewState'),
		getLatestMsg(channel.id, adapter.whoami(), 'ApproveState')
			.then(augmentWithBalances),
	])
	.then(function([newMsg, approveMsg]) {
		const latestIsApproved = newMsg && approveMsg && newMsg.stateRoot == approveMsg.stateRoot
		// there are no unapproved NewState messages, only merge all eventAggrs
		if (!newMsg || latestIsApproved) {
			return producer.tick(channel)
			.then(function(res) {
				return { nothingNew: !res.newStateTree }
			})
		}

		return producer.tick(channel, true)
		.then(function(res) {
			return onNewState(adapter, { ...res, newMsg, approveMsg })
		})
	})
	.then(res => heartbeatIfNothingNew(adapter, channel, res))
}

function onNewState(adapter, {channel, balances, newMsg, approveMsg}) {
	const prevBalances = toBNMap(approveMsg ? approveMsg.balances : {})
	const newBalances = toBNMap(newMsg.balances)
	const { balancesAfterFees } = newMsg

	if (!isValidTransition(channel, prevBalances, newBalances)) {
		console.error(`validatatorWorker: ${channel.id}: invalid transition requested in NewState`, prevBalances, newBalances)
		return { nothingNew: true }
	}

	if(!isValidValidatorFees(channel, newBalances, balancesAfterFees)) {
		console.error(`validatatorWorker: ${channel.id}: invalid validator fees requested in NewState`, 
			toBNStringMap(newBalances), toBNStringMap(balancesAfterFees))
		return { nothingNew: true }
	}

	const whoami = adapter.whoami()
	const leader = channel.spec.validators[0]
	const otherValidators = channel.spec.validators.filter(v => v.id != whoami)
	const { stateRoot, signature } = newMsg

	// verify the stateRoot hash of newMsg: whether the stateRoot really represents this balance tree
	if (!isValidRootHash(stateRoot, { channel, balancesAfterFees, adapter })){
		console.error(`validatatorWorker: ${channel.id}: invalid state root hash `, stateRoot)
		return { nothingNew: true }
	}

	// verify the signature of newMsg: whether it was signed by the leader validator
	return adapter.verify(leader.id, stateRoot, signature)
	.then(function(isValidSig) {
		if (!isValidSig) {
			console.error(`validatatorWorker: ${channel.id}: invalid signature NewState`, prevBalances, newBalances)
			return { nothingNew: true }
		}
    
		const stateRootRaw = Buffer.from(stateRoot, 'hex')
		return adapter.sign(stateRootRaw)
		.then(function(signature) {
			return persistAndPropagate(adapter, otherValidators, channel, {
				type: 'ApproveState',
				stateRoot: stateRoot,
				isHealthy: isHealthy(balances, newBalances),
				signature,
			})
		})
	})
}

function isValidValidatorFees(channel, balances, balancesAfterFees) {
	const calcBalancesAfterFees = toBNStringMap(getBalancesAfterFeesTree(balances, channel))
	return isEqual(calcBalancesAfterFees, toBNStringMap(balancesAfterFees))
}

// @TODO getLatestMsg should be a part of a DB abstraction so we can use it in other places too
// e.g. validating on POST /validator-messages (to get the previous), and a public API to get the latest msgs of a type
function getLatestMsg(channelId, from, type) {
	const validatorMsgCol = db.getMongo().collection('validatorMessages')
	// @TODO: this assumption of getting the latest is flawed; won't work if it's within the same second: https://docs.mongodb.com/manual/reference/method/ObjectId/
	// it is very important that we get this right, since it will be used to gather data about the channel state too
	return validatorMsgCol.find({
		channelId,
		from: from,
		'msg.type': type,
	})
	.sort({ _id: -1 })
	.limit(1)
	.toArray()
	.then(function([o]) {
		return o ? o.msg : null
	})
}

// ApproveState messages do not contain the full `balances`; so augment them
function augmentWithBalances(approveMsg) {
	if (!approveMsg) return

	const validatorMsgCol = db.getMongo().collection('validatorMessages')
	return validatorMsgCol.findOne({
		'msg.type': 'NewState',
		'msg.stateRoot': approveMsg.stateRoot,
	})
	.then(function(o) {
		assert.ok(o && o.msg && o.msg.balances, 'cannot find NewState message corresponding to the ApproveState')
		return { ...approveMsg, balances: o.msg.balances }
	})
}

module.exports = { tick }

