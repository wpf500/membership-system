import express from 'express';
import passport from 'passport';
import { getRepository } from 'typeorm';

import { Members } from '@core/database';
import { isValidNextUrl, getNextParam, loginAndRedirect, wrapAsync } from '@core/utils';

import MemberPermission, { PermissionType } from '@models/MemberPermission';

import config from '@config';

const app = express();

app.set( 'views', __dirname + '/views' );

app.get( '/' , function( req, res ) {
	const nextParam = req.query.next as string;
	if ( req.user ) {
		res.redirect( isValidNextUrl(nextParam) ? nextParam : '/' );
	} else {
		res.render( 'index', { nextParam: getNextParam( nextParam ) } );
	}
} );

if (config.dev) {
	app.get('/as/:permission', wrapAsync( async (req, res) => {
		const permission = await getRepository(MemberPermission).findOne({
			permission: req.params.permission as PermissionType
		});
		const member = permission && await Members.findById(permission.memberId);
		if (member) {
			loginAndRedirect(req, res, member);
		} else {
			res.redirect('/login');
		}
	}));
}

app.get( '/:code', wrapAsync( async function( req, res ) {
	const nextParam = req.query.next as string;
	const member = await Members.findOne( {
		'loginOverride.code': req.params.code,
		'loginOverride.expires': {$gt: new Date()}
	} );

	if (member) {
		await member.update({$unset: {loginOverride: 1}});

		loginAndRedirect(req, res, member, isValidNextUrl(nextParam) ? nextParam : '/');
	} else {
		req.flash('error', 'login-code-invalid');
		res.redirect( '/login' );
	}
} ) );

app.post( '/', (req, res) => {
	const nextParam = req.query.next as string;
	passport.authenticate( 'local', {
		failureRedirect: '/login' + getNextParam( nextParam ),
		failureFlash: true
	} )( req, res, () => {
		req.session.method = 'plain';
		res.redirect( isValidNextUrl( nextParam ) ? nextParam : '/' );
	} );
} );

export default app;
