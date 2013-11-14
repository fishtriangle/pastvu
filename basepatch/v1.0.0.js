/*global, print: true, printjson: true*/
'use strict';

var log4js = require('log4js'),
	mongoose = require('mongoose'),
	logger;

module.exports.loadController = function (app, db) {
	logger = log4js.getLogger("systemjs.js");

	saveSystemJSFunc(function pastvuPatch() {
		var startTime = Date.now(),
			countBegin = db.users_comments_view.count();

		//Сливаем все фотографии с разными статусами в одну коллекцию
		print('Updating ' + db.photos.count() + ' public photos for state 5');
		db.photos.update({}, {$set: {s: 5}}, {multi: true});
		print('Inserting ' + db.photos_fresh.count() + ' fresh photos for state 0');
		db.photos_fresh.find().forEach(function (photo) {
			photo.s = 0;
			db.photos.insert(photo);
		});
		db.photos_fresh.drop();
		print('Inserting ' + db.photos_disabled.count() + ' disabled photos for state 7');
		db.photos_disabled.find().forEach(function (photo) {
			photo.s = 7;
			db.photos.insert(photo);
		});
		db.photos_disabled.drop();
		print('Inserting ' + db.photos_del.count() + ' del photos for state 9');
		db.photos_del.find().forEach(function (photo) {
			photo.s = 9;
			db.photos.insert(photo);
		});
		db.photos_del.drop();

		return {message: 'FINISH in total ' + (Date.now() - startTime) / 1000 + 's', updated: db.users_comments_view.count() - countBegin};
	});

	/**
	 * Save function to db.system.js
	 * @param func
	 */
	function saveSystemJSFunc(func) {
		if (!func || !func.name) {
			logger.error('saveSystemJSFunc: function name is not defined');
		}
		db.db.collection('system.js').save(
			{
				_id: func.name,
				value: new mongoose.mongo.Code(func.toString())
			},
			function saveCallback(err) {
				if (err) {
					logger.error(err);
				}
			}
		);
	}
};
