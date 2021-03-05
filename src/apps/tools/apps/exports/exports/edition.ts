import { Brackets, createQueryBuilder, getRepository, LessThan, MoreThan } from 'typeorm';

import { Members } from '@core/database';
import { ContributionType } from '@core/utils';
import { Param } from '@core/utils/params';

import Export from '@models/Export';
import { Member } from '@models/members';
import MemberPermission from '@models/MemberPermission';

import { ExportType } from './type';

async function getParams(): Promise<Param[]> {
	return [{
		name: 'monthlyAmountThreshold',
		label: 'Monthly contribution amount threshold',
		type: 'number'
	}, {
		name: 'includeNonOptIn',
		label: 'Include those without delivery opt in',
		type: 'boolean'
	}];
}

async function getQuery({params}: Export) {
	const now = new Date();
	const memberships = await createQueryBuilder(MemberPermission, 'mp')
		.where({permission: 'member', dateAdded: LessThan(now)})
		.andWhere(new Brackets(qb => {
			qb.where('mp.dateExpires >= :now', {now})
				.orWhere('mp.dateExpires = NULL');
		}))
		.getMany();

	return {
		_id: {$in: memberships.map(p => p.memberId)},
		contributionMonthlyAmount: {
			$gte: params?.monthlyAmountThreshold === undefined ? 3 : params?.monthlyAmountThreshold
		},
		...(!params?.includeNonOptIn && {delivery_optin: true})
	};
}

async function getExport(members: Member[], {id: exportId}: Export) {
	const exportIds =
		(await getRepository(Export).find({where: {type: 'edition'}, order: {date: 'ASC'}})).map(e => e.id);

	function getExportNo(id: string) {
		const i = exportIds.findIndex(id2 => id === id2);
		return i > -1 ? i : exportIds.length;
	}

	const currentExportNo = getExportNo(exportId);

	return members
		.map(member => {
			const postcode = (member.delivery_address.postcode || '').trim().toUpperCase();
			return {
				EmailAddress: member.email,
				FirstName: member.firstname,
				LastName: member.lastname,
				Address1: member.delivery_address.line1,
				Address2: member.delivery_address.line2,
				City: member.delivery_address.city,
				Postcode: postcode,
				ReferralLink: member.referralLink,
				IsGift: member.contributionType === ContributionType.Gift,
				// TODO: IsFirstEdition: _.every(member.exports, e => getExportNo(e.export_id) >= currentExportNo),
				NumCopies: member.delivery_copies === undefined ? 2 : member.delivery_copies,
				ContributionMonthlyAmount: member.contributionMonthlyAmount
			};
		})
		.sort((a, b) => b.LastName.toLowerCase() > a.LastName.toLowerCase() ? -1 : 1);
}

export default {
	name: 'Edition export',
	statuses: ['added', 'sent'],
	collection: Members,
	itemName: 'members',
	getParams,
	getQuery,
	getExport
} as ExportType<Member>;
