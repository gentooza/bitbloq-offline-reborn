//  drag$drop.js is part of bitbloq-offline-reborn.
//
// Copyright 2019 BQ staff (see package.json)
// Copyright 2021-2026 Joaquín Cuéllar-Padilla <joa (dot) cuellar (at) riseup (dot) net>
//
// bitbloq-offline-reborn is free software: you can redistribute it and/or modify it under 
// the terms of the GNU General Public License as published by the Free Software Foundation, 
// either version 3 of the License, or (at your option) any later version.
//
// bitbloq-offline-reborn is distributed in the hope that it will
// be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with bitbloq-offline-reborn.
// If not, see <https://www.gnu.org/licenses/>.

(function() {
    'use strict';

    // Create the module and define its dependencies.
    var app = angular.module('bitbloqOffline');

    app.directive('draggable', draggable);
    app.directive('droppable', droppable);

    function draggable() {
        return function(scope, element, attrs) {
            var el = element[0];
            el.draggable = true;


            var dragGhost = null;
            // creating a ghost image seems to be needed for fixing under GNU/Linux? wayland?
            function buildGhost(imgEl, pad) {
                var r = imgEl.getBoundingClientRect();
                var w = Math.round(r.width)  || imgEl.naturalWidth  || imgEl.width  || 75;
                var h = Math.round(r.height) || imgEl.naturalHeight || imgEl.height || 75;

                var ghost = document.createElement('div');
                ghost.style.position = 'fixed';
                ghost.style.left = '0px';
                ghost.style.top = '0px';
                ghost.style.width = (w + pad) + 'px';
                ghost.style.height = (h + pad) + 'px';

                ghost.style.opacity = '0.01';
                ghost.style.pointerEvents = 'none';

                ghost.style.backgroundImage = 'url("' + (imgEl.currentSrc || imgEl.src) + '")';
                ghost.style.backgroundRepeat = 'no-repeat';
                ghost.style.backgroundPosition = pad + 'px ' + pad + 'px';
                ghost.style.backgroundSize = w + 'px ' + h + 'px';

                document.body.appendChild(ghost);
                return ghost;
            }

            el.addEventListener('dragstart', function(e) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', 'bb');

                var imgEl = el.tagName === 'IMG' ? el : el.querySelector('img');
                if (!imgEl) 
                    imgEl = el

                var r  = el.getBoundingClientRect();
                var ox = e.clientX - r.left;
                var oy = e.clientY - r.top;

                var pad = 32;
                dragGhost = buildGhost(imgEl, pad);

                e.dataTransfer.setData('mouseOffsetX', String(ox));
                e.dataTransfer.setData('mouseOffsetY', String(oy));
                e.dataTransfer.setData('dragtype:' + attrs.dragtype, '');
                e.dataTransfer.setData('dragtype', attrs.dragtype);
                e.dataTransfer.setData('dragcategory', attrs.dragcategory);
                e.dataTransfer.setData('dragid', attrs.dragid); 
                e.dataTransfer.setDragImage(dragGhost, 0, 0);
                el.classList.add('dragging'); 
            }, false);

            el.addEventListener('dragend', function() {
                this.classList.remove('dragging');
                if (dragGhost && dragGhost.parentNode) 
                    dragGhost.parentNode.removeChild(dragGhost);
                dragGhost = null;
            }, false);
        };
    }


    function droppable() {
        return {
            scope: {
                drop: '=', // parent
                dropOffsetTop: '='
            },
            link: function(scope, element, attrs) {
                var el = element[0];

                var dragEnterLeaveCounter = 0;

                el.addEventListener('dragover', function(e) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    e.stopPropagation();
                    return false;
                }, false);

                el.addEventListener('dragenter', function(e) {
                    e.preventDefault();
                    dragEnterLeaveCounter++;
                    var isBoard = e.dataTransfer.types.indexOf('dragtype:board'); //We can access to dataTransfer content
                    var isComponent = e.dataTransfer.types.indexOf('dragtype:component');
                    var type = null;
                    if (isBoard !== -1) {
                        type = 'board';
                    } else if (isComponent !== -1) {
                        type = 'component';
                    }
                    this.classList.add('dragging-over');
                    this.classList.add('dragging-' + type);
                }, false);

                el.addEventListener('dragleave', function() {
                    dragEnterLeaveCounter--;
                    if (dragEnterLeaveCounter === 0) {
                        this.classList.remove('dragging-over');
                        this.classList.remove('dragging-board');
                        this.classList.remove('dragging-component');
                    }
                }, false);

                el.addEventListener('drop', function(e) {
                    e.preventDefault();
                    e.stopPropagation();

                    var mx = parseFloat(e.dataTransfer.getData('mouseOffsetX')) || 0;
                    var my = parseFloat(e.dataTransfer.getData('mouseOffsetY')) || 0;
                    var dropLeft = parseFloat(attrs.dropOffsetLeft) || 0;

                    var coordinates = {
                        x: e.clientX - dropLeft - mx,
                        y: e.clientY - getFieldOffsetTop(scope.dropOffsetTop) - my
                    };

                    var droppingEvent = {
                        type: e.dataTransfer.getData('dragtype'),
                        id: e.dataTransfer.getData('dragid'),
                        coordinates: coordinates,
                        category: e.dataTransfer.getData('dragcategory')
                    };

                    scope.$apply(function() {
                        if (typeof scope.drop === 'function') scope.drop(droppingEvent);
                        else console.warn('drop is not a function:', scope.drop);
                    });

                    return false;
                }, false);
                // GNU/Linux fix continues here, it can be removed in near future
                var draggingInternal = false;
                var lastX = 0;
                var lastY = 0;
                var lastPayload = null;

                function typesHas(dt, t) {
                    try {
                        var types = dt && dt.types;
                        if (!types) 
                            return false;
                        if (typeof types.contains === 'function') 
                            return types.contains(t);
                        return Array.prototype.indexOf.call(types, t) !== -1;
                    } catch (e) {
                        return false;
                    }
                }

                function insideDroppable(x, y) {
                    var r = el.getBoundingClientRect();
                    return (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
                }

                function readPayload(dt) {
                    try {
                        var type = dt.getData('dragtype');
                        if (!type) 
                            return null;
                        return {
                            type: type,
                            id: dt.getData('dragid'),
                            category: dt.getData('dragcategory'),
                            mouseOffsetX: parseFloat(dt.getData('mouseOffsetX')) || 0,
                            mouseOffsetY: parseFloat(dt.getData('mouseOffsetY')) || 0
                        };
                    } catch (e) {
                        return null;
                    }
                }

                function onMouseMove(e) {
                    if (!draggingInternal) 
                        return;
                    if (typeof e.clientX === 'number') 
                        lastX = e.clientX;
                    if (typeof e.clientY === 'number') 
                        lastY = e.clientY;
                }

                function onWinDragStart(e)
                {
                    if (!e || !e.dataTransfer) 
                        return;
                    if (typesHas(e.dataTransfer, 'Files')) 
                        return;
                    draggingInternal = true;
                    var p = readPayload(e.dataTransfer);
                    if (p) 
                        lastPayload = p;
                    if (e.clientX || e.clientY) {
                        lastX = e.clientX;
                        lastY = e.clientY;
                    }
                }

                function onWinDragEnd(e)
                {
                    draggingInternal = false;
                    if (!lastPayload) 
                        return;
                    var x = (e && (e.clientX || e.clientY)) ? e.clientX : lastX;
                    var y = (e && (e.clientX || e.clientY)) ? e.clientY : lastY;
                    if (insideDroppable(x, y)) {
                        var dropLeft = parseFloat(attrs.dropOffsetLeft) || 0;
                        var coordinates = {
                            x: x - dropLeft - lastPayload.mouseOffsetX,
                            y: y - getFieldOffsetTop(scope.dropOffsetTop) - lastPayload.mouseOffsetY
                        };

                        var droppingEvent = {
                            type: lastPayload.type,
                            id: lastPayload.id,
                            coordinates: coordinates,
                            category: lastPayload.category
                        };

                        scope.$apply(function () {
                            if (typeof scope.drop === 'function') 
                                scope.drop(droppingEvent);
                        });
                    }
                    lastPayload = null;
                }


                window.addEventListener('mousemove', onMouseMove, true);
                window.addEventListener('dragstart', onWinDragStart, false);
                window.addEventListener('dragend', onWinDragEnd, true);

                scope.$on('$destroy', function () {
                    window.removeEventListener('mousemove', onMouseMove, true);
                    window.removeEventListener('dragstart', onWinDragStart, true);
                    window.removeEventListener('dragend', onWinDragEnd, true);
                });
            }
        };
    }

    var getFieldOffsetTop = function(source) {
        var fieldOffsetTop = 0;
        var tempElement;
        if(source)
        {
            for (var i = 0; i < source.length; i++) {
                tempElement = document.getElementsByClassName(source[i]);
                if (tempElement[0])
                    fieldOffsetTop += tempElement[0].clientHeight;
            }
        }
        return fieldOffsetTop;
    };
})();