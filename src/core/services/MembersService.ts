import { getRepository } from 'typeorm';

import { generateCode } from '@core/authentication';
import gocardless from '@core/gocardless';
import { log } from '@core/logging';
import mailchimp from '@core/mailchimp';

import EmailService from '@core/services/EmailService';

import { Address } from '@models/GiftFlow';
import GCPaymentData from '@models/GCPaymentData';
import Member, { PartialMember } from '@models/Member';
import MemberProfile from '@models/MemberProfile';
import { isDuplicateIndex } from '@core/utils';

export default class MembersService {
	static generateMemberCode(member: Pick<Member,'firstname'|'lastname'>): string {
		const no = ('000' + Math.floor(Math.random() * 1000)).slice(-3);
		return (member.firstname[0] + member.lastname[0] + no).toUpperCase();
	}

	static async createMember(partialMember: PartialMember, partialProfile: Partial<MemberProfile> = {}): Promise<Member> {
		try {
			const member = getRepository(Member).create({
				...partialMember,
				referralCode: this.generateMemberCode(partialMember),
				pollsCode: this.generateMemberCode(partialMember),
				permissions: []
			});
			await getRepository(Member).save(member);

			const profile = getRepository(MemberProfile).create({...partialProfile, member});
			await getRepository(MemberProfile).save(profile);

			return member;
		} catch (error) {
			if (isDuplicateIndex(error, 'referralCode') || isDuplicateIndex(error, 'pollsCode')) {
				return await MembersService.createMember(partialMember);
			}
			throw error;
		}
	}

	static async addMemberToMailingLists(member: Member): Promise<void> {
		try {
			await mailchimp.mainList.addMember(member);
		} catch (err) {
			log.error({
				app: 'join-utils',
				error: err,
			}, 'Adding member to MailChimp failed, probably a bad email address: ' + member.id);
		}
	}

	static async updateMember(member: Member, updates: Partial<Member>): Promise<void> {
		log.info( {
			app: 'members-service',
			action: 'update-member',
			sensitive: {
				memberId: member.id,
				updates
			}
		} );

		const needsSync = updates.email && updates.email !== member.email ||
			updates.firstname && updates.firstname !== member.firstname ||
			updates.lastname && updates.lastname !== member.lastname;

		const oldEmail = member.email;

		member = Object.assign(member, 	updates);
		await getRepository(Member).save(member);

		if (needsSync) {
			await MembersService.syncMemberDetails(member, oldEmail);
		}
	}

	static async updateDeliveryAddress(member: Member, optIn: boolean, address?: Address): Promise<boolean> {
		if (!optIn && !address) {
			return false;
		}

		await getRepository(MemberProfile).update(member.id, {
			deliveryOptIn: optIn,
			deliveryAddress: optIn ? address : undefined
		});

		return true;
	}

	static async syncMemberDetails(member: Member, oldEmail: string): Promise<void> {
		if ( member.isActiveMember ) {
			try {
				await mailchimp.mainList.updateMemberDetails( member, oldEmail );
			} catch (err) {
				if (err.response && err.response.status === 404) {
					await MembersService.addMemberToMailingLists(member);
				} else {
					throw err;
				}
			}
		}

		// TODO: Unhook this from MembersService
		const gcData = await getRepository(GCPaymentData).findOne({member});
		if ( gcData && gcData.customerId) {
			await gocardless.customers.update( gcData.customerId, {
				email: member.email,
				given_name: member.firstname,
				family_name: member.lastname
			} );
		}
	}

	static async resetMemberPassword(email: string): Promise<void> {
		const member = await getRepository(Member).findOne({email});
		if (member) {
			member.password.resetCode = generateCode();
			await getRepository(Member).save(member);
			await EmailService.sendTemplateToMember('reset-password', member);
		}
	}

	static async permanentlyDeleteMember(member: Member): Promise<void> {
		await getRepository(Member).delete(member.id);
	}
}
