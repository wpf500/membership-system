import express from 'express';
import moment from 'moment';
import { getRepository } from 'typeorm';

import { hasNewModel, hasSchema, isAdmin } from '@core/middleware';
import { createDateTime, wrapAsync } from '@core/utils';

import Notice from '@models/Notice';

import { createNoticeSchema } from './schemas.json';

const app = express();

interface NoticeSchema {
	name: string,
	expiresDate?: string,
	expiresTime?: string,
	text: string,
	url?: string,
	enabled?: boolean
}

function schemaToNotice(data: NoticeSchema): Notice {
	const notice = new Notice();
	notice.name = data.name;
	notice.expires = createDateTime(data.expiresDate, data.expiresTime);
	notice.text = data.text;
	notice.url = data.url;
	notice.enabled = !!data.enabled;

	return notice;
}

app.set( 'views', __dirname + '/views' );

app.use( isAdmin );

app.get( '/', wrapAsync( async ( req, res ) => {
	const notices = await getRepository(Notice).find();
	res.render( 'index', { notices } );
} ) );

app.post( '/', hasSchema( createNoticeSchema ).orFlash, wrapAsync( async ( req, res ) => {
	const notice = schemaToNotice(req.body);
	await getRepository(Notice).save(notice);
	req.flash('success', 'notices-created');
	res.redirect('/tools/notices/' + notice.id);
} ) );

app.get( '/:id', hasNewModel(Notice, 'id'), wrapAsync( async ( req, res ) => {
	res.render( 'notice', { notice: req.model } );
} ) );

app.post( '/:id', hasNewModel(Notice, 'id'), wrapAsync( async ( req, res ) => {
	const notice = req.model as Notice;

	switch ( req.body.action ) {
	case 'update':
		await getRepository(Notice).update(notice.id, schemaToNotice(req.body));
		req.flash( 'success', 'notices-updated' );
		res.redirect( '/tools/notices/' + notice.id );
		break;

	case 'delete':
		await getRepository(Notice).delete(notice.id);
		req.flash( 'success', 'notices-deleted' );
		res.redirect( '/tools/notices' );
		break;
	}

} ) );

export default app;
