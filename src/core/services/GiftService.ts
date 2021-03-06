import hummus from 'hummus';
import moment from 'moment';
import { getRepository } from 'typeorm';

import { log as mainLogger } from '@core/logging';
import stripe from '@core/lib/stripe';
import { ContributionType, isDuplicateIndex } from '@core/utils';

import EmailService from '@core/services/EmailService';
import MembersService from '@core/services/MembersService';

import GiftFlow, { Address, GiftForm } from '@models/GiftFlow';
import Member from '@models/Member';
import MemberPermission from '@models/MemberPermission';

import config from '@config';

const log = mainLogger.child({app: 'gift-service'});

export default class GiftService {
	private static readonly giftMonthlyAmount = 3;

	static async createGiftFlow(giftForm: GiftForm): Promise<string> {
		log.info({
			action: 'create-gift-flow',
			data: {giftForm}
		});

		const giftFlow = await GiftService.createGiftFlowWithCode(giftForm);

		const session = await stripe.checkout.sessions.create({
			success_url: config.audience + '/gift/thanks/' + giftFlow.id,
			cancel_url: config.audience + '/gift',
			customer_email: giftForm.fromEmail,
			payment_method_types: ['card'],
			line_items: [{
				name: `Gift membership - ${giftForm.months} month${giftForm.months != 1 ? 's' : ''}`,
				amount: giftForm.months * GiftService.giftMonthlyAmount * 100,
				currency: config.currencyCode.toLowerCase(),
				quantity: 1
			}]
		});

		await getRepository(GiftFlow).update(giftFlow.id, {sessionId: session.id});

		return session.id;
	}

	static async completeGiftFlow(sessionId: string): Promise<void> {
		const giftFlowRepository = getRepository(GiftFlow);
		const giftFlow = await giftFlowRepository.findOne({where: {sessionId}});

		log.info({
			action: 'complete-gift-flow',
			data: {
				sessionId,
				giftFlowId: giftFlow?.id
			}
		});

		if (giftFlow) {
			await giftFlowRepository.update(giftFlow.id, {completed: true});

			const { fromName, fromEmail, firstname, startDate } = giftFlow.giftForm;
			const now = moment.utc();

			const giftCard = GiftService.createGiftCard(giftFlow.setupCode);
			const attachments = [{
				type: 'application/pdf',
				name: 'Gift card.pdf',
				content: giftCard.toString('base64')
			}];

			await EmailService.sendTemplateTo(
				'purchased-gift',
				{email: fromEmail, name: fromName},
				{fromName, gifteeFirstName: firstname, giftStartDate: startDate},
				{attachments}
			);

			// Immediately process gifts for today
			if (moment.utc(startDate).isSame(now, 'day')) {
				await GiftService.processGiftFlow(giftFlow, true);
			}
		}
	}

	static async processGiftFlow(giftFlow: GiftFlow, sendImmediately = false): Promise<void> {
		log.info({
			action: 'process-gift-flow',
			data: {
				giftFlow: {...giftFlow, giftForm: undefined},
				sendImmediately
			}
		});

		const {
			firstname, lastname, email, deliveryAddress, months, fromName, message
		} = giftFlow.giftForm;
		const now = moment.utc();

		if (giftFlow.processed) return;

		await getRepository(GiftFlow).update(giftFlow.id, {processed: true});

		const member = await MembersService.createMember({
			firstname, lastname, email,
			contributionType: ContributionType.Gift
		}, {
			deliveryOptIn: !!deliveryAddress?.line1,
			deliveryAddress: deliveryAddress
		});

		member.contributionMonthlyAmount = GiftService.giftMonthlyAmount;

		const membership = new MemberPermission();
		membership.permission = 'member';
		membership.dateExpires = now.clone().add(months, 'months').toDate();
		member.permissions.push(membership);

		await getRepository(Member).save(member);

		await getRepository(GiftFlow).update(giftFlow.id, {giftee: member});

		const sendAt = sendImmediately ? undefined : now.clone().startOf('day').add({h: 9, m: 0, s: 0}).format();
		await EmailService.sendTemplateToMember(
			'giftee-success', member,
			{fromName, message: message || '', giftCode: giftFlow.setupCode},
			{sendAt}
		);

		await MembersService.addMemberToMailingLists(member);
	}

	static async updateGiftFlowAddress(giftFlow: GiftFlow, giftAddress: Address, deliveryAddress: Address): Promise<void> {
		log.info({
			action: 'update-gift-flow-address',
			data: {
				giftFlowId: giftFlow.id
			}
		});

		if (!giftFlow.processed && !giftFlow.giftForm.giftAddress) {
			await getRepository(GiftFlow).update(giftFlow.id, {
				giftForm: {
					giftAddress,
					deliveryAddress
				}
			});
		}
	}

	private static async createGiftFlowWithCode(giftForm: GiftFlow['giftForm']): Promise<GiftFlow> {
		try {
			const giftFlow = new GiftFlow();
			giftFlow.sessionId = 'UNKNOWN';
			giftFlow.setupCode = MembersService.generateMemberCode(giftForm);
			giftFlow.giftForm = giftForm;
			await getRepository(GiftFlow).insert(giftFlow);
			return giftFlow;

		} catch (error) {
			if (isDuplicateIndex(error, 'setupCode')) {
				return await GiftService.createGiftFlowWithCode(giftForm);
			}
			throw error;
		}
	}

	private static createGiftCard(code: string) {
		const inStream = new hummus.PDFRStreamForFile(__dirname + '/../../static/pdfs/gift.pdf');
		const outStream = new hummus.PDFWStreamForBuffer();

		const pdfWriter = hummus.createWriterToModify(inStream, outStream);
		const font = pdfWriter.getFontForFile(__dirname + '/../../static/fonts/Lato-Regular.ttf');

		const pageModifier = new hummus.PDFPageModifier(pdfWriter, 0, true);
		const context = pageModifier.startContext().getContext();

		context.cm(-1, 0, 0, -1, 406, 570);
		context.writeText(
			'thebristolcable.org/gift/' + code, 0, 0, {
				font,
				size: 14,
				color: 0x000000
			}
		);

		pageModifier.endContext().writePage();
		pdfWriter.end();

		return outStream.buffer;
	}
}
