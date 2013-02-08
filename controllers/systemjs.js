'use strict';

var step = require('step'),
    log4js = require('log4js'),
    mongoose = require('mongoose'),
    logger;

module.exports.loadController = function (app, db) {
    logger = log4js.getLogger("systemjs.js");

    saveSystemJSFunc(function clusterPhoto(cid, geoPhotoNew) {
        if (!cid || !geoPhotoNew || geoPhotoNew.length !== 2) {
            return {message: 'Bad params to set photo cluster', error: true};
        }

        var clusters = db.clusterparams.find({sgeo: {$exists: false}}, {_id: 0}).sort({z: 1}).toArray(),
            photos = db.photos.find({'cid': cid}, {geo: 1, file: 1}).toArray();

        photos.forEach(function (photo, index, arr) {
            var geoPhoto = photo.geo, // Текущие координаты фото
            // Коррекция для кластера.
            // Так как кластеры высчитываются бинарным округлением (>>), то для отрицательного lng надо отнять единицу.
            // Так как отображение кластера идет от верхнего угла, то для положительного lat надо прибавить единицу
                geoPhotoCorrection = [geoPhoto[0] < 0 ? -1 : 0, geoPhoto[1] > 0 ? 1 : 0], // Корекция для кластера текущих координат
                geoPhotoNewCorrection = [geoPhotoNew[0] < 0 ? -1 : 0, geoPhotoNew[1] > 0 ? 1 : 0], // Корекция для кластера новых координат
                cluster,
                c,
                geo,
                geoNew,
                gravity,
                gravityNew;

            clusters.forEach(function (item) {

                geo = geoToPrecisionRound([item.w * ((geoPhoto[0] / item.w >> 0) + geoPhotoCorrection[0]), item.h * ((geoPhoto[1] / item.h >> 0) + geoPhotoCorrection[1])]);
                geoNew = geoToPrecisionRound([item.w * ((geoPhotoNew[0] / item.w >> 0) + geoPhotoNewCorrection[0]), item.h * ((geoPhotoNew[1] / item.h >> 0) + geoPhotoNewCorrection[1])]);
                cluster = db.clusters.findOne({p: photo._id, z: item.z, geo: geo}, {_id: 0, c: 1, gravity: 1, file: 1, p: {$slice: -2}});

                if (!cluster || (cluster && (geo[0] !== geoNew[0] || geo[1] !== geoNew[1]))) {
                    item.wHalf = toPrecisionRound(item.w / 2);
                    item.hHalf = toPrecisionRound(item.h / 2);

                    // Если фотография в старых координатах уже лежит в кластере, удаляем фото из него
                    if (cluster) {
                        c = cluster.c || 0;
                        gravity = cluster.gravity || [geo[0] + item.wHalf, geo[1] + item.hHalf];
                        gravityNew = geoToPrecisionRound([(gravity[0] * (c + 1) - geoPhoto[0]) / (c), (gravity[1] * (c + 1) - geoPhoto[1]) / (c)]);

                        if (c > 1) {
                            // Если после удаления фото из кластера, в этом кластере еще остаются другие фото, берем у одного из них file
                            var photoFile,
                                $set = {gravity: gravityNew},
                                $unset = {};

                            if (cluster.p && cluster.p.length > 0) {
                                photoFile = db.photos.find({_id: {$in: cluster.p}}, {_id: 0, file: 1}) || undefined;
                                if (photoFile[0] && photoFile[0].file && photoFile[0].file !== cluster.file) {
                                    photoFile = photoFile[0].file;
                                } else if (photoFile[1] && photoFile[1].file && photoFile[1].file !== cluster.file) {
                                    photoFile = photoFile[1].file;
                                }
                            }

                            if (photoFile) {
                                $set.file = photoFile;
                            } else {
                                $unset.file = true;
                            }

                            db.clusters.update({z: item.z, geo: geo}, { $inc: {c: -1}, $pull: { p: photo._id }, $set: $set, $unset: $unset }, {multi: false, upsert: false});

                        } else {
                            // Если после удаления фото из кластера, кластер становится пустым - удаляем его
                            db.clusters.remove({z: item.z, geo: geo});
                        }
                    }

                    // Вставляем фото в новый кластер
                    cluster = db.clusters.findOne({z: item.z, geo: geoNew}, {_id: 0, c: 1, gravity: 1});
                    c = (cluster && cluster.c) || 0;
                    gravity = (cluster && cluster.gravity) || [geoNew[0] + item.wHalf, geoNew[1] + item.hHalf];
                    gravityNew = geoToPrecisionRound([(gravity[0] * (c + 1) + geoPhotoNew[0]) / (c + 2), (gravity[1] * (c + 1) + geoPhotoNew[1]) / (c + 2)]);

                    db.clusters.update({z: item.z, geo: geoNew}, { $inc: {c: 1}, $push: { p: photo._id }, $set: {gravity: gravityNew, file: photo.file} }, {multi: false, upsert: true});
                }
            });
            return {message: 'Ok', error: false};
        });
    });

    saveSystemJSFunc(function clusterAll() {
        var clusters = db.clusterparams.find({sgeo: {$exists: false}}, {_id: 0}).sort({z: 1}).toArray(),
            photoCounter = 0,
            photoCursor = db.photos.find({geo: {$size: 2}}, {geo: 1, file: 1});

        db.clusters.remove();

        // forEach в данном случае - это честный while по курсору: function (func) {while (this.hasNext()) {func(this.next());}}
        photoCursor.forEach(function (photo) {
            var geoPhoto = photo.geo,
                geoPhotoCorrection = [geoPhoto[0] < 0 ? -1 : 0, geoPhoto[1] > 0 ? 1 : 0],
                geo,
                cluster,
                c,
                gravity,
                gravityNew;

            photoCounter++;

            clusters.forEach(function (item) {
                item.wHalf = toPrecisionRound(item.w / 2);
                item.hHalf = toPrecisionRound(item.h / 2);

                geo = geoToPrecisionRound([item.w * ((geoPhoto[0] / item.w >> 0) + geoPhotoCorrection[0]), item.h * ((geoPhoto[1] / item.h >> 0) + geoPhotoCorrection[1])]);
                cluster = db.clusters.findOne({z: item.z, geo: geo}, {_id: 0, c: 1, gravity: 1});
                c = (cluster && cluster.c) || 0;
                gravity = (cluster && cluster.gravity) || [geo[0] + item.wHalf, geo[1] + item.hHalf];
                gravityNew = geoToPrecisionRound([(gravity[0] * (c + 1) + geoPhoto[0]) / (c + 2), (gravity[1] * (c + 1) + geoPhoto[1]) / (c + 2)]);

                db.clusters.update({z: item.z, geo: geo}, { $inc: {c: 1}, $push: { p: photo._id }, $set: {gravity: gravityNew, file: photo.file} }, {multi: false, upsert: true});
            });
        });

        return {message: 'Ok', photos: photoCounter, clusters: db.clusters.count()};
    });

    saveSystemJSFunc(function toPrecision(number, precision) {
        var divider = Math.pow(10, precision || 6);
        return ~~(number * divider) / divider;
    });

    saveSystemJSFunc(function toPrecisionRound(number, precision) {
        var divider = Math.pow(10, precision || 6);
        return Math.round(number * divider) / divider;
    });

    saveSystemJSFunc(function geoToPrecision(geo, precision) {
        geo.forEach(function (item, index, array) {
            array[index] = toPrecision(item, precision || 6);
        });
        return geo;
    });

    saveSystemJSFunc(function geoToPrecisionRound(geo, precision) {
        geo.forEach(function (item, index, array) {
            array[index] = toPrecisionRound(item, precision || 6);
        });
        return geo;
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
