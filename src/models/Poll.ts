import moment from 'moment';
import { Column, CreateDateColumn, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import PollResponse from './PollResponse';

export type PollTemplate = 'custom'|'builder'|'ballot';

export enum PollAccess {
	Guest = 'guest',
	Anonymous = 'anonymous',
	Member = 'member'
}

@Entity()
export default class Poll {
	@PrimaryColumn()
	slug!: string

	@CreateDateColumn()
	date!: Date

	@Column()
	template!: PollTemplate

	@Column({type: 'jsonb', default: '{}'})
	templateSchema!: Record<string, unknown>

	@Column()
	title!: string

	@Column({nullable: true})
	mcMergeField?: string

	@Column({nullable: true})
	pollMergeField?: string

	@Column({default: true})
	closed!: boolean

	@Column({nullable: true})
	starts?: Date

	@Column({nullable: true})
	expires?: Date

	@Column()
	allowUpdate!: boolean

	@Column({default: PollAccess.Member})
	access!: PollAccess

	@Column({default: false})
	hidden!: boolean

	@OneToMany(() => PollResponse, r => r.poll)
	responses!: PollResponse[]

	responseCount?: number

	get active(): boolean {
		const now = moment.utc();
		return !this.closed && (!this.starts || now.isAfter(this.starts)) &&
			(!this.expires || now.isBefore(this.expires));
	}
}
