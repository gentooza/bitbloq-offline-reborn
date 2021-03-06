'use strict';

/**
 * @ngdoc service
 * @name bitbloqOffline.web2board
 * @description
 * # web2board
 * Service in the bitbloqOffline.
 */
angular.module('bitbloqOffline')
    .factory('web2board', function ($rootScope, $log, $q, _, $timeout, common, alertsService, WSHubsAPI, OpenWindow, $location) {

        /** Variables */
        var web2board = this,
            api,
            inProgress = false,
            usingPort = null,
            TIME_FOR_WEB2BOARD_TO_START = 700,
            w2bToast = null,
            plotterWin = null; //ms

        web2board.config = {
            wsHost: '127.0.0.1',
            wsPort: 9877,
            serialPort: ''
        };

        function getWeb2boardCommand() {
            var platformOs = process.platform;
            if (platformOs === 'win32') {
                return common.appPath + "/app/res/web2board/win32/web2boardLauncher.exe";
            }
            if (platformOs === 'darwin') {
                return common.appPath + "/app/res/web2board/darwin/Web2Board.app/Contents/MacOS/web2boardLauncher";
            }
            if (process.arch === "x64") {
                return common.appPath + "/app/res/web2board/linux/web2boardLauncher";
            }
            return common.appPath + "/app/res/web2board/linux32/web2boardLauncher";
        }

        function showUpdateModal() {
            alert("W2b not detected");
        }

        function startWeb2board() {
            console.log('starting Web2board...');
            var spawn = require('child_process'),
                web2boardProcess = spawn.execFile(getWeb2boardCommand(),
                    ["--port", web2board.config.wsPort], function (err, stdout, stderr) {
                        console.log(stdout);
                        console.log(stderr);
                        console.log(err);
                    });
            web2boardProcess.on("close", function (code) {
                console.log("Web2board closed with code: " + code);
            });
        }

        function openCommunication(callback, showUpdateModalFlag, tryCount) {
            tryCount = tryCount || 0;
            tryCount++;
            if (tryCount === 1) {
                w2bToast = alertsService.add('web2board_toast_startApp', 'web2board', 'loading');
            }

            showUpdateModalFlag = showUpdateModalFlag === true && tryCount >= 20;
            callback = callback || function () {
                };

            if (!api.wsClient || (api.wsClient.readyState !== WebSocket.CONNECTING && api.wsClient.readyState !== WebSocket.OPEN)) {
                api.connect().done(function () {
                        api.wsClient.couldSuccessfullyConnect = true;
                        alertsService.close(w2bToast);
                        api.UtilsAPIHub.server.setId("Bitbloq").done(callback);
                    },
                    function () { //on error
                        if (showUpdateModalFlag) {
                            alertsService.close(w2bToast);
                            showUpdateModal();
                        } else {
                            if (tryCount === 1) {
                                // we only need to start web2board once
                                startWeb2board();
                            }
                            $timeout(function () {
                                openCommunication(callback, true, tryCount);
                            }, TIME_FOR_WEB2BOARD_TO_START);
                        }
                    }
                );
            } else {
                api.UtilsAPIHub.server.getId().done(callback, function () {
                    api.wsClient = null;
                    startWeb2board();
                    openCommunication(callback, showUpdateModalFlag, 0);
                }, 2000);
            }
        }

        function handleUploadError(error) {
            if (error.title === 'COMPILE_ERROR') {
                alertsService.add('alert-web2board-compile-error', 'web2board', 'warning', undefined, error.stdErr);
            } else if (error.title === 'BOARD_NOT_READY') {
                alertsService.add('alert-web2board-no-port-found', 'web2board', 'warning');
            } else {
                var errorTag = 'alert-web2board-upload-error';
                alertsService.add(errorTag, 'web2board', 'warning', undefined, error);
            }
        }

        function removeInProgressFlag() {
            $rootScope.$apply(function () {
                inProgress = false;
            });
        }

        function isBoardReady(board) {
            if (!board) {
                alertsService.add('alert-web2board-boardNotReady', 'web2board', 'warning');
            }
            return board;
        }

        function openPlotter(board, port) {
            port = port.split("/").join("_");
            var windowArguments = {
                url: 'plotter/' + port + '/' + board.mcu,
                title: 'Plotter',
                width: 800,
                height: 600,
                'min-width': 500,
                'min-height': 200
            };

            plotterWin = OpenWindow.open(windowArguments, function () {
                $timeout(function () {
                    // api.SerialMonitorHub.server.closeConnection(port);
                    api.SerialMonitorHub.server.unsubscribeFromHub();
                }, 0);
            });
        }

        function closePlotter() {
            try {
                plotterWin.close();
            } catch (e) {
                // catching error if plotterWin is already closed
            }
        }

        function closeUsingPort(cb) {
            closePlotter();
            if (usingPort) {
                console.log("closing port", usingPort);
                api.SerialMonitorHub.server.closeConnection(usingPort)
                    .done(cb, cb, 2000);
            } else {
                cb()
            }
        }

        api = WSHubsAPI.construct('ws://' + web2board.config.wsHost + ':' + web2board.config.wsPort, 45);

        api.defaultErrorHandler = function (error) {
            $log.error('Error receiving message: ' + error);
        };

        api.callbacks.onClose = function (error) {
            $log.error('web2board disconnected with error: ' + error.reason);
            api.clearTriggers();
            inProgress = false;
            if (api.wsClient.couldSuccessfullyConnect) {
                alertsService.add('web2board_toast_closedUnexpectedly', 'web2board', 'warning');
            }
        };

        api.callbacks.onMessageError = function (error) {
            $log.error('Error receiving message: ' + error);
            api.wsClient.close();
        };

        api.CodeHub.client.isCompiling = function () {
            alertsService.add('alert-web2board-compiling', 'web2board', 'loading', undefined);
        };

        api.CodeHub.client.isUploading = function (port) {
            alertsService.add('alert-web2board-uploading', 'web2board', 'loading', undefined, port);
        };

        api.CodeHub.client.isSettingPort = function (port) {
            $log.debug('is setting port in: ' + port);
            web2board.serialPort = port;
        };

        web2board.verify = function (code) {
            //It is not mandatory to have a board connected to verify the code
            if (!inProgress) {
                inProgress = true;
                openCommunication(function () {
                    api.CodeHub.server.compile(code).done(function () {
                        alertsService.add('alert-web2board-compile-verified', 'web2board', 'ok', 5000);
                    }, function (error) {
                        alertsService.add('alert-web2board-compile-error', 'web2board', 'warning', undefined, error);
                    }).finally(removeInProgressFlag);
                });
            }
        };

        web2board.upload = function (board, code) {
            if (!inProgress) {
                closePlotter();
                if (!code || !board) {
                    alertsService.add('alert-web2board-boardNotReady', 'web2board', 'warning');
                    return;
                }
                inProgress = true;
                openCommunication(function () {
                    alertsService.add('alert-web2board-settingBoard', 'web2board', 'loading');
                    api.CodeHub.server.upload(code, board.mcu).done(function () {
                        alertsService.add('alert-web2board-code-uploaded', 'web2board', 'ok', 5000);
                    }, handleUploadError).finally(removeInProgressFlag);
                });
            }
        };

        web2board.serialMonitor = function (board) {
            if (!inProgress && isBoardReady(board)) {
                inProgress = true;
                openCommunication(function () {
                    closeUsingPort(function () {
                        var serialMonitorAlert = alertsService.add('alert-web2board-openSerialMonitor', 'web2board', 'loading');
                        api.SerialMonitorHub.server.findBoardPort(board.mcu).done(function (port) {
                            usingPort = port;
                            api.SerialMonitorHub.server.startApp(port, board.mcu).done(function () {
                                alertsService.close(serialMonitorAlert);
                            }, function () {
                                alertsService.add('alert-web2board-no-port-found', 'web2board', 'warning');
                            }).finally(removeInProgressFlag);
                        }, function () {
                            alertsService.add('alert-web2board-no-port-found', 'web2board', 'warning');
                        }).finally(removeInProgressFlag);
                    });
                });
            }
        };

        web2board.version = function () {
            openCommunication();
        };

        web2board.uploadHex = function (boardMcu, hexText) {
            closePlotter();
            openCommunication(function () {
                alertsService.add('alert-web2board-settingBoard', 'web2board', 'loading');
                api.CodeHub.server.uploadHex(hexText, boardMcu).done(function (port) {
                    alertsService.add('alert-web2board-code-uploaded', 'web2board', 'ok', 5000, port);
                }, handleUploadError).finally(removeInProgressFlag);
            });
        };

        web2board.showApp = function () {
            openCommunication(function () {
                alertsService.add('web2board_toast_showingApp', 'web2board', 'loading');
                api.WindowHub.server.showApp().done(function () {
                    alertsService.add('web2board_toast_successfullyOpened', 'web2board', 'ok', 3000);
                });
            });
        };

        web2board.showPlotter = function (board) {
            if (!inProgress && isBoardReady(board)) {
                openCommunication(function () {
                    closeUsingPort(function () {
                        var chartMonitorAlert = alertsService.add('alert-web2board-openPlotter', 'web2board', 'loading');
                        api.SerialMonitorHub.server.findBoardPort(board.mcu).done(function (port) {
                            usingPort = port;
                            alertsService.close(chartMonitorAlert);
                            openPlotter(board, port);
                        }, function () {
                            alertsService.close(chartMonitorAlert);
                            alertsService.add('alert-web2board-no-port-found', 'web2board', 'warning');
                        }).finally(removeInProgressFlag);
                    });
                });
            }
        };

        return {
            verify: web2board.verify,
            upload: web2board.upload,
            serialMonitor: web2board.serialMonitor,
            version: web2board.version,
            uploadHex: web2board.uploadHex,
            showWeb2board: web2board.showApp,
            showPlotter: web2board.showPlotter,
            isInProcess: function () {
                return inProgress;
            },
            api: api
        };

    });