var __root = '../../../..';
var __src = __root + '/src';
var __js = __src + '/js';
var __config = __root + '/config';

var	express = require( 'express' ),
	app = express();

var auth = require( __js + '/authentication' );

var app_config = {};

app.set( 'views', __dirname + '/views' );

app.use( function( req, res, next ) {
	if ( req.user.setupComplete ) {
		res.redirect( '/profile' );
	} else {
		res.locals.app = app_config;
		res.locals.breadcrumb.push( {
			name: app_config.title,
			url: app.parent.mountpath + app.mountpath
		} );
		res.locals.activeApp = app_config.uid;
		next();
	}
} );

app.get( '/', auth.isLoggedIn, function( req, res ) {
	res.render( 'complete', { user: req.user } );
} );

const completeSchema = {
	body: {
		type: 'object',
		required: ['password', 'verify', 'delivery_optin'],
		properties: {
			email: {
				type: 'string',
				format: 'email'
			},
			password: {
				type: 'string',
				format: 'password'
			},
			verify: {
				const: { '$data': '1/password' }
			},
			delivery_optin: {
				type: 'boolean'
			},
			reason: {
				type: 'string'
			}
		},
		oneOf: [
			{
				required: ['delivery_line1', 'delivery_city', 'delivery_postcode'],
				properties: {
					delivery_optin: {
						const: true
					},
					delivery_line1: {
						type: 'string'
					},
					delivery_line2: {
						type: 'string'
					},
					delivery_city: {
						type: 'string'
					},
					delivery_postcode: {
						type: 'string'
					}
				}
			},
			{
				properties: {
					delivery_optin: {
						const: false
					}
				}
			}
		]
	}
};

app.post( '/', auth.isLoggedIn, function( req, res ) {
	const { body : { email, password, delivery_optin, delivery_line1, delivery_line2, delivery_city,
		delivery_postcode, reason } } = req;

	if ( email != req.user.email ) {
		// TODO: Update email
	}
	
	auth.generatePassword( req.body.password, function( password ) {
		req.user.update( { $set: {
			email, password, delivery_optin,
			delivery_address: delivery_optin ? {
				line1: delivery_line1,
				line2: delivery_line2,
				city: delivery_city,
				postcode: delivery_postcode
			} : {},
			join_reason: reason
		} }, function () {
			res.redirect( '/profile' );
		} );
	} );
} );

module.exports = function( config ) {
	app_config = config;
	return app;
};
