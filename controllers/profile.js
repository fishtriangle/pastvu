'use strict';

var auth = require('./auth.js'),
	_session = require('./_session.js'),
	Settings,
	User,
	Utils = require('../commons/Utils.js'),
	step = require('step'),
	log4js = require('log4js'),
	_ = require('lodash'),
	logger,
	msg = {
		deny: 'You do not have permission for this action'
	};

//Сохраняем изменемя в профиле пользователя
function saveUser(socket, data, cb) {
	var iAm = socket.handshake.session.user,
		login = data && data.login,
		itsMe,
		newValues;

	if (!iAm) {
		return cb({message: msg.deny, error: true});
	}
	if (!Utils.isType('object', data) || !login) {
		return cb({message: 'Bad params', error: true});
	}
	itsMe = iAm.login === login;

	step(
		function () {
			if (iAm.login === login) {
				this(null, iAm);
			} else {
				User.findOne({login: login}, this);
			}
		},
		function (err, user) {
			if (err && !user) {
				return cb({message: err.message || 'Requested user does not exist', error: true});
			}
			//Новые значения действительно изменяемых свойств
			newValues = Utils.diff(_.pick(data, 'firstName', 'lastName', 'showName', 'birthdate', 'sex', 'country', 'city', 'work', 'www', 'icq', 'skype', 'aim', 'lj', 'flickr', 'blogger', 'aboutme'), user.toObject());
			if (_.isEmpty(newValues)) {
				return cb({message: 'Nothing to save'});
			}

			_.assign(user, newValues);
			user.save(this);
		},
		function (err, user) {
			if (err) {
				return cb({message: err.message, error: true});
			}
			cb({message: 'ok', saved: 1});

			if (itsMe) {
				auth.sendMe(socket);
			}
			logger.info('Saved story line for ' + user.login);
		}
	);
}

module.exports.loadController = function (app, db, io) {
	logger = log4js.getLogger("profile.js");

	Settings = db.model('Settings');
	User = db.model('User');

	io.sockets.on('connection', function (socket) {
		var hs = socket.handshake;

		socket.on('giveUser', function (data) {
			User.getUserPublic(data.login, function (err, user) {
				socket.emit('takeUser', (user && user.toObject()) || {error: true, message: err && err.messagee});
			});
		});

		socket.on('saveUser', function (data) {
			saveUser(socket, data, function (resultData) {
				socket.emit('saveUserResult', resultData);
			});
		});
	});

};