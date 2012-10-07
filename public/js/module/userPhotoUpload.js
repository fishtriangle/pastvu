/*global requirejs:true, require:true, define:true*/
/**
 * Модель фотографий пользователя
 */
define(['underscore', 'Browser', 'Utils', 'socket', 'globalParams', 'knockout', 'knockout.mapping', 'm/_moduleCliche', 'globalVM', 'm/User', 'm/Users', 'load-image', 'text!tpl/userPhotoUpload.jade', 'css!style/userPhotoUpload', 'jquery.ui.widget', 'jquery.fileupload/jquery.iframe-transport', 'jquery.fileupload/jquery.fileupload', 'jquery.fileupload/jquery.fileupload-ui', 'jquery.fileupload/locale'], function (_, Browser, Utils, socket, GP, ko, ko_mapping, Cliche, globalVM, User, users, loadImage, jade) {
    'use strict';

    /**
     * Для некоторых браузеров необходимо смещать input в сторону, чтобы срабатывало изменение курсора
     * При этом надо генерировать событие клик на таком input'е
     */
    ko.bindingHandlers.fileUploadInput = {
        init: function (element, valueAccessor, allBindingsAccessor, viewModel) {
            // First get the latest data that we're bound to
            var value = valueAccessor(), allBindings = allBindingsAccessor(),
                valueUnwrapped = ko.utils.unwrapObservable(value),
                $element = $(element),
                id = $element.attr('id');

            // Now manipulate the DOM element
            if (valueUnwrapped === true) {
                if (Browser.name === 'FIREFOX' || Browser.name === 'MSIE') {
                    $element
                        .css({'left': '141px'})
                        .attr('size', (viewModel.filereader() ? GP.Width() / 8 : 10))
                        .on("click", function (event) {
                            event.stopPropagation(); // Чтобы опять не вызвать клик родительского элемента
                        })
                        .offsetParent().on("click", function (event) {
                            $('#' + id).trigger('click');
                        });
                }
            }
        }
    };

    return Cliche.extend({
        jade: jade,
        create: function () {
            this.destroy = _.wrap(this.destroy, this.localDestroy);

            this.auth = globalVM.repository['m/auth'];
            this.u = null;

            this.$fileupload = this.$dom.find('#fileupload');
            this.filereader = ko.observable(Browser.support.filereader);
            this.filelist = ko.observableArray([]);

            $(document)
                .on('dragenter', '#dropzone', function () {
                    this.parentNode.classList.add('dragover');
                })
                .on('dragleave', '#dropzone', function () {
                    this.parentNode.classList.remove('dragover');
                });

            var user = globalVM.router.params().user || this.auth.iAm.login();

            users.user(user, function (vm) {
                this.u = vm;

                ko.applyBindings(globalVM, this.$dom[0]);

                // Initialize the jQuery File Upload widget:
                this.$dom.find('#fileupload').fileupload();
                this.$dom.find('#fileupload').fileupload('option', {
                    url: 'http://172.31.1.130:8888/',
                    dropZone: this.$dom.find('.addfiles_area'),
                    maxFileSize: 52428800, //50Mb
                    maxNumberOfFiles: 10,
                    previewSourceMaxFileSize: 52428800, //50MB The maximum file size of images that are to be displayed as preview:
                    previewMaxWidth: 320, // The maximum width of the preview images:
                    previewMaxHeight: 180, // The maximum height of the preview images:
                    acceptFileTypes: /(\.|\/)(jpe?g|png)$/i,
                    process: [
                        {
                            action: 'load',
                            fileTypes: /^image\/(jpeg|png)$/,
                            maxFileSize: 52428800 // 50MB
                        }/*,
                         {
                         action: 'resize',
                         maxWidth: 1440,
                         maxHeight: 900
                         },
                         {
                         action: 'save'
                         }*/
                    ],
                    change: this.fileAdd.bind(this),
                    drop: this.fileAdd.bind(this),
                    dragover: function (e) {
                        //this.$dom.find('.addfiles_area')[0].classList.add('dragover');
                    }.bind(this),
                    done: function (e, data) {
                        console.log('done');
                    }.bind(this)
                });

                this.show();

            }, this);
        },
        show: function () {
            this.$container.fadeIn(400, function () {
                this.$dom.find('#fileupload').fileupload('enable');
            }.bind(this));
        },
        hide: function () {
            this.$dom.find('#fileupload').fileupload('disable');
            $(document).off('dragenter').off('dragleave');
            this.$container.css('display', '');
        },
        localDestroy: function (destroy) {
            this.$dom.find('#fileupload').fileupload('destroy');
            destroy.call(this);
        },

        fileAdd: function (e, data) {
            this.$dom.find('.addfiles_area')[0].classList.remove('dragover');
            $.each(data.files, function (index, file) {
                file.uid = Utils.randomString(7);
                file.humansize = Utils.formatFileSize(file.size);
                file.uploaded = ko.observable(false);
                this.filelist.push(file);
                loadImage(
                    file,
                    function (img) {
                        var td = this.$dom.find("[data-fileuid='" + file.uid + "']");
                        if (td.length > 0) {
                            td.append(img);
                            window.setTimeout(function () {
                                td.css({height: img.height, opacity: 1});
                                index = file = img = td = null;
                            }, 250);
                        }
                    }.bind(this),
                    {
                        maxWidth: 300,
                        maxHeight: 200,
                        canvas: true
                    }
                );
            }.bind(this));
        },
        send: function (viewModel) {
            this.$dom.find('#fileupload').fileupload('send', {files: viewModel.filelist()})
                .success(function (result, textStatus, jqXHR) {
                    console.log(textStatus);
                })
                .error(function (jqXHR, textStatus, errorThrown) { console.log(textStatus); })
                .complete(function (result, textStatus, jqXHR) { console.log(textStatus); });
            viewModel.filelist().forEach(function (item) {
                item.uploaded(true);
            });
        }
    });
});