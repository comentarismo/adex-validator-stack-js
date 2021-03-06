const { Joi } = require('celebrate')

const numericString = Joi.string().regex(/^\d+$/)

const validatorMessage = Joi.object({
	type: Joi.string()
		.valid(['NewState', 'ApproveState', 'Heartbeat', 'Accounting', 'RejectState'])
		.required(),
	stateRoot: Joi.string()
		.length(64)
		.when('type', {
			is: ['NewState', 'ApproveState', 'Heartbeat'],
			then: Joi.string().required()
		}),
	signature: Joi.string().when('type', {
		is: ['NewState', 'ApproveState', 'Heartbeat'],
		then: Joi.string().required()
	}),
	lastEvAggr: Joi.string()
		.isoDate()
		.when('type', {
			is: ['Accounting'],
			then: Joi.string()
				.isoDate()
				.required()
		}),
	balances: Joi.object()
		.keys()
		.pattern(/./, numericString)
		.when('type', {
			is: ['NewState', 'Accounting'],
			then: Joi.object()
				.keys()
				.pattern(/./, numericString)
				.required()
		}),
	timestamp: Joi.string()
		.isoDate()
		.when('type', {
			is: 'Heartbeat',
			then: Joi.string()
				.isoDate()
				.required()
		}),
	balancesBeforeFees: Joi.object()
		.keys()
		.pattern(/./, numericString)
		.when('type', {
			is: 'Accounting',
			then: Joi.object()
				.keys()
				.pattern(/./, numericString)
				.required()
		}),
	reason: Joi.string().when('type', {
		is: 'RejectState',
		then: Joi.string().required()
	}),
	isHealthy: Joi.boolean().when('type', {
		is: 'ApproveState',
		then: Joi.boolean().required()
	})
})

const sentryValidatorMessage = Joi.object({
	from: Joi.string().required(),
	received: Joi.string()
		.isoDate()
		.required(),
	msg: Joi.array().items(validatorMessage)
})

module.exports = {
	createChannel: {
		id: Joi.string().required(),
		depositAsset: Joi.string().required(),
		depositAmount: numericString.required(),
		// UNIX timestamp; we're not using Jai.date() cause
		// we want it to be stored in MongoDB as a number
		validUntil: Joi.number()
			.integer()
			.required(),
		creator: Joi.string().required(),
		spec: Joi.object({
			adUnits: Joi.array().items(Joi.object()),
			targeting: Joi.array().items(Joi.object()),
			validators: Joi.array()
				.items(
					Joi.object({
						id: Joi.string().required(),
						url: Joi.string()
							.uri({
								scheme: ['http', 'https']
							})
							.required(),
						fee: numericString.required()
					})
				)
				.required()
				.length(2),
			withdrawPeriodStart: Joi.number().required(),
			minPerImpression: numericString.default('1'),
			maxPerImpression: numericString.default('1'),
			eventSubmission: Joi.object({ allow: Joi.array().items(Joi.object()) }),
			nonce: Joi.string(),
			created: Joi.number(),
			activeFrom: Joi.number()
		}).required()
	},
	validatorMessage: {
		messages: Joi.array().items(validatorMessage)
	},
	events: {
		events: Joi.array().items(
			Joi.object({
				type: Joi.string().required(),
				publisher: Joi.string()
			})
		)
	},
	sentry: {
		message: sentryValidatorMessage,
		lastApproved: Joi.object({
			newState: sentryValidatorMessage,
			approveState: sentryValidatorMessage
		}),
		events: Joi.array().items(
			Joi.object({
				channelId: Joi.string().required(),
				created: Joi.string()
					.isoDate()
					.required(),
				events: Joi.object()
					.keys()
					.pattern(
						/./,
						Joi.object({
							eventCounts: Joi.object()
								.keys()
								.pattern(/./, Joi.string())
								.required(),
							eventPayouts: Joi.object()
								.keys()
								.pattern(/./, Joi.string())
								.required()
						})
					)
					.required()
			})
		)
	}
}
