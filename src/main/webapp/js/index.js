/**
 * NCube Editor
 *     IDE for building and editing NCubes
 *
 * @author John DeRegnaucourt (jdereg@gmail.com)
 *         <br>
 *         Copyright (c) Cedar Software LLC
 *         <br><br>
 *         Licensed under the Apache License, Version 2.0 (the "License");
 *         you may not use this file except in compliance with the License.
 *         You may obtain a copy of the License at
 *         <br><br>
 *         http://www.apache.org/licenses/LICENSE-2.0
 *         <br><br>
 *         Unless required by applicable law or agreed to in writing, software
 *         distributed under the License is distributed on an "AS IS" BASIS,
 *         WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *         See the License for the specific language governing permissions and
 *         limitations under the License.
 */

// TODO: After cube is changed (Edit Columns, Update Axis, Edit Cell) - need to fetch latest n-cubeInfo DTO and update client-side cache.
var NCE = (function ($)
{
    var head = 'HEAD';
    var _searchThread;
    var _heartBeatThread;
    var _cubeList = {};
    var _apps = [];
    var _statuses = ['RELEASE', 'SNAPSHOT'];
    var _versions = [];
    var _openCubes = localStorage[OPEN_CUBES];
    try
    {
        _openCubes = JSON.parse(_openCubes);

        if (Object.prototype.toString.call(_openCubes) !== '[object Array]'
            || (_openCubes.length > 0 && typeof _openCubes[0] !== 'object')) {
            _openCubes = [];
        }
        else if (!_openCubes[0].hasOwnProperty('cubeKey'))
        {
            _openCubes = [];
        }
    }
    catch (e)
    {
        _openCubes = []
    }
    var _selectedCubeName = localStorage[SELECTED_CUBE];
    var _selectedApp = localStorage[SELECTED_APP];
    var _selectedVersion = localStorage[SELECTED_VERSION];
    var _selectedBranch;
    if (localStorage.getItem(SELECTED_BRANCH) == null)
    {
        localStorage[SELECTED_BRANCH] = head;
        _selectedBranch = head;
    }
    else
    {
        _selectedBranch = localStorage[SELECTED_BRANCH];
    }
    var _selectedStatus = localStorage[SELECTED_STATUS] || 'SNAPSHOT';
    var _errorId = null;
    var _activeTabViewType = localStorage[ACTIVE_TAB_VIEW_TYPE];
    if (!_activeTabViewType)
    {
        _activeTabViewType = 'n-cube' + PAGE_ID;
    }
    var _defaultTab = null;
    var _searchNames = $('#cube-search');
    var _searchContent = $('#cube-search-content');
    var _cubeCount = $('#ncubeCount');
    var _listOfCubes= $('#ncube-list');
    var _mainTabPanel = $('#ncubeTabContent');
    var _openTabsPanel = $('#ncube-tabs');
    var _openTabList = _openTabsPanel.find('ul');
    var _diffOutput = $('#diffOutput');
    var _mergeCubeName = null;
    var _mergeSha1 = null;
    var _mergeHeadSha1 = null;
    var _searchLastKeyTime = Date.now();
    var _searchKeyPressed = false;
    var _diffLastResult = null;
    var _diffLeftName = '';
    var _diffRightName = '';
    var _menuOptions = [];
    var _tabOverflow = $('#tab-overflow');
    var _branchNames = [];
    var _hiddenCell = $('#test-cell');

    //  modal dialogs
    var _selectBranchModal = $('#selectBranchModal');
    var _commitModal = $('#commitRollbackModal');
    var _diffModal = $('#diffOutputModal');

    initialize();

    function initialize()
    {
        try
        {
            setupMainSplitter();
            startWorkers();
            showActiveBranch();
            loadAppNames();
            loadVersions();
            loadNCubes();
            loadAppListView();
            loadStatusListView();
            loadVersionListView();
            buildMenu();
            clearSearch();
            loop();
            heartBeat();
            addListeners();
        }
        catch (e)
        {
            console.log(e);
        }
    }

    function setupMainSplitter() {
        $('body').layout({
            name: "BodyLayout"
            //	reference only - these options are NOT required because 'true' is the default
            , closable: true	// pane can open & close
            , resizable: true	// when open, pane can be resized
            , slidable: true	// when closed, pane can 'slide' open over other panes - closes on mouse-out
            , livePaneResizing: true
            , togglerLength_open: 60
            , togglerLength_closed: "100%"
            //	some pane animation settings
            , west__animatePaneSizing: false
            , west__fxName_open: "none"
            , west__fxName_close: "none"	// NO animation when closing west-pane
            , spacing_open: 5
            , spacing_closed: 5
            , west__resizeable: true
            , west__size: 250
            , west__minSize: 140
            //	enable showOverflow on west-pane so CSS popups will overlap north pane
            , west__showOverflowOnHover: true
            , center__triggerEventsOnLoad: true
            , center__maskContents: true
            //	enable state management
            , stateManagement__enabled: false // automatic cookie load & save enabled by default
            , showDebugMessages: false // log and/or display messages from debugging & testing code
            , onresize_end: function() {
                buildTabs();
            }
        });
    }

    function addCurrentCubeTab() {
        var cubeInfo = [_selectedApp, _selectedVersion, _selectedStatus, _selectedBranch, _selectedCubeName, getActiveTabViewType()];
        _openCubes.unshift({cubeKey:cubeInfo.join(TAB_SEPARATOR)});
        localStorage[OPEN_CUBES] = JSON.stringify(_openCubes);
        buildTabs();
    }

    function getOpenCubeIndex(cubeInfo) {
        var cis = cubeInfo.join(TAB_SEPARATOR);
        for (var i = 0, len = _openCubes.length; i < len; i++) {
            if (cis === _openCubes[i].cubeKey) {
                return i;
            }
        }
    }

    function removeTab(cubeInfo) {
        _openCubes.splice(getOpenCubeIndex(cubeInfo), 1);
        localStorage[OPEN_CUBES] = JSON.stringify(_openCubes);

        if (_selectedApp === cubeInfo[CUBE_INFO.APP]
            && _selectedVersion === cubeInfo[CUBE_INFO.VERSION]
            && _selectedStatus === cubeInfo[CUBE_INFO.STATUS]
            && _selectedBranch === cubeInfo[CUBE_INFO.BRANCH]
            && _selectedCubeName === cubeInfo[CUBE_INFO.NAME]
            && getActiveTabViewType() === cubeInfo[CUBE_INFO.TAB_VIEW]) {
            if (_openCubes.length > 0) {
                var newCubeInfo = _openCubes[0].cubeKey.split(TAB_SEPARATOR);
                reloadEnvIfNeeded(newCubeInfo);
            } else {
                switchTabPane(null);
            }
        }

        buildTabs();
    }

    function reloadEnvIfNeeded(cubeInfo) {
        var appChanged = _selectedApp !== cubeInfo[CUBE_INFO.APP];
        var verChanged = _selectedVersion !== cubeInfo[CUBE_INFO.VERSION];
        var staChanged = _selectedStatus !== cubeInfo[CUBE_INFO.STATUS];
        var braChanged = _selectedBranch !== cubeInfo[CUBE_INFO.BRANCH];
        makeCubeInfoActive(cubeInfo);

        if (appChanged || verChanged || staChanged || braChanged) {
            if (appChanged || verChanged || staChanged) {
                if (appChanged) {
                    loadAppNames();
                    loadAppListView();
                }
                loadVersions();
                loadStatusListView();
                loadVersionListView();
            }
            showActiveBranch();
            loadNCubes();
            loadNCubeListView();
        }
    }

    function removeAllTabs() {
        _openCubes = [];
        delete localStorage[OPEN_CUBES];
        buildTabs();
    }

    function startWorkers()
    {
        if (typeof(Worker) !== 'undefined')
        {
            /**
             * Background worker thread that will send search filter text asynchronously to server,
             * fetch the results, and ship to main thread (which will be updated to the filtered list).
             */
            _searchThread = new Worker('js/loadCubeList.js');
            _searchThread.onmessage = function(event)
            {
                var list = event.data;
                loadFilteredNCubeListView(list);
            };

            // background thread for heartbeat
            _heartBeatThread = new Worker('js/heartBeat.js');
            _heartBeatThread.onmessage = function(event) {
                var result = event.data.obj;
                for (var i = 0, len = result.length; i < len; i++) {
                    for (var x = 0, xLen = _openCubes.length; x < xLen; x++) {
                        var curCube = _openCubes[x];
                        var curRes = result[i];
                        if (curCube.cubeKey.indexOf(curRes.key) > -1) {
                            curCube.status = curRes.status;
                        }
                    }
                }
                localStorage[OPEN_CUBES] = JSON.stringify(_openCubes);
                updateTabStatus();
            };
        }
        else
        {
            alert('Sorry! No Web Worker support. Try using the Chrome browser.');
        }
    }

    function makeCubeInfoActive(cubeInfo) {
        _selectedApp = cubeInfo[CUBE_INFO.APP];
        _selectedVersion = cubeInfo[CUBE_INFO.VERSION];
        _selectedStatus = cubeInfo[CUBE_INFO.STATUS];
        _selectedBranch = cubeInfo[CUBE_INFO.BRANCH];
        _selectedCubeName = cubeInfo[CUBE_INFO.NAME];
        setActiveTabViewType(cubeInfo[CUBE_INFO.TAB_VIEW]);
    }

    function selectTab(cubeInfo) {
        deselectTab();
        var tab = $('#' + cubeInfo.join(TAB_SEPARATOR).replace(/\./g,'_').replace(/~/g,'\\~'));
        if (tab.length < 1) {
            tab = _openTabList.children().first();
            var id = tab.prop('id');
            cubeInfo[CUBE_INFO.TAB_VIEW] = id.substring(id.lastIndexOf('~') + 1);
            id = id.substring(0, id.lastIndexOf('~'));
            cubeInfo[CUBE_INFO.NAME] = id.substring(id.lastIndexOf('~') + 1);
        }
        tab.addClass('active');

        makeCubeInfoActive(cubeInfo);
        localStorage[SELECTED_APP] = _selectedApp;
        localStorage[SELECTED_VERSION] = _selectedVersion;
        localStorage[SELECTED_STATUS] = _selectedStatus;
        localStorage[SELECTED_BRANCH] = _selectedBranch;
        localStorage[SELECTED_CUBE] = _selectedCubeName;
        localStorage[ACTIVE_TAB_VIEW_TYPE] = getActiveTabViewType();
        tab.find('a.' + CLASS_ACTIVE_VIEW).removeClass(CLASS_ACTIVE_VIEW);
        tab.find('a').filter(function()
        {
            return $(this)[0].textContent.trim() === getActiveTabViewType().replace(PAGE_ID,'');
        }).addClass(CLASS_ACTIVE_VIEW);

        switchTabPane(getActiveTabViewType());
    }

    function deselectTab() {
        _openTabList.find('li.dropdown.active').removeClass('active');
    }

    function getTabImage(imgSrc) {
        return imgSrc ? '<img src="' + imgSrc + '" height="16px" width="16px"/>' : '';
    }

    function addTab(cubeInfo, status) {
        deselectTab();
        var imgSrc;
        for (var x = 0, xLen = _menuOptions.length; x < xLen; x++) {
            var opt = _menuOptions[x];
            if (opt.pageId === cubeInfo[CUBE_INFO.TAB_VIEW]) {
                imgSrc = opt.imgSrc;
                break;
            }
        }
        var link = $('<a/>')
            .attr('href','#')
            .addClass('dropdown-toggle ncube-tab-top-level')
            .addClass(status)
            .html(getTabImage(imgSrc)
                + '<span class="tab-text">' + cubeInfo[CUBE_INFO.NAME] + '</span>'
                + '<span class="click-space"><span class="big-caret"></span></span>'
                + '<span class="glyphicon glyphicon-remove tab-close-icon" aria-hidden="true"></span>'
            );
        link.attr('data-toggle', 'dropdown');
        var li = $('<li/>');
        function closeTab() {
            li.removeClass('open');
            li.tooltip('hide');
            li.find('button').remove();
            li.find('input').remove();
            $('div.dropdown-backdrop').hide();
        }

        li.addClass('active');
        li.addClass('dropdown');
        li.attr('id', cubeInfo.join(TAB_SEPARATOR).replace(/\./g,'_'));
        li.tooltip({
            trigger: 'hover',
            placement: 'auto top',
            animate: true,
            delay: 250,
            container: 'body',
            title: cubeInfo[CUBE_INFO.APP] + ' - ' + cubeInfo[CUBE_INFO.VERSION] + ' - ' + cubeInfo[CUBE_INFO.STATUS] + ' - ' + cubeInfo[CUBE_INFO.BRANCH] + ' - ' + cubeInfo[CUBE_INFO.NAME],
            template: '<div class="tooltip" role="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner tab-tooltip"></div></div>'
        });
        li.click(function(e) {
            // only show dropdown when clicking the caret, not just the tab
            var target = $(e.target);
            var isClose = target.hasClass('glyphicon-remove');
            var isDroptdown = target.hasClass('click-space') || target.hasClass('big-caret');

            if (isClose) {
                li.tooltip('destroy');
                removeTab(cubeInfo);
            } else {
               if (isDroptdown) { // clicking caret for dropdown
                    $(this).find('.ncube-tab-top-level')
                        .addClass('dropdown-toggle')
                        .attr('data-toggle', 'dropdown');
                    $(document).one('click', function() { // prevent tooltip and dropdown from remaining on screen
                        closeTab();
                    });
                } else { // when clicking tab show tab, not dropdown
                   $(this).find('.ncube-tab-top-level')
                        .removeClass('dropdown-toggle')
                        .attr('data-toggle', '')
                        .tab('show');
                }

                var cubChanged = _selectedCubeName !== cubeInfo[CUBE_INFO.NAME];
                var tabChanged = getActiveTabViewType() !== cubeInfo[CUBE_INFO.TAB_VIEW];

                reloadEnvIfNeeded(cubeInfo);
                if (cubChanged || tabChanged) {
                    selectTab(cubeInfo);
                    saveState();
                }
            }
        });

        var dd = $('<ul/>');
        dd.addClass('dropdown-menu tab-menu');

        for (var menuIdx = 0, menuLen = _menuOptions.length; menuIdx < menuLen; menuIdx++) {
            (function() {
                var menuOption = _menuOptions[menuIdx];
                var pageId = menuOption.pageId;
                var imgHtml = getTabImage(menuOption.imgSrc);

                var anc = $('<a/>')
                    .attr('href', '#')
                    .html(imgHtml + NBSP + menuOption.key)
                    .click(function (e) {
                        clearError();
                        setActiveTabViewType(pageId);
                        var ci2 = [cubeInfo[CUBE_INFO.APP], cubeInfo[CUBE_INFO.VERSION], cubeInfo[CUBE_INFO.STATUS], cubeInfo[CUBE_INFO.BRANCH], cubeInfo[CUBE_INFO.NAME], getActiveTabViewType()];
                        var cia2 = ci2.join(TAB_SEPARATOR);
                        var tabIdx = getOpenCubeIndex(ci2);
                        var isCtrlKey = e.metaKey || e.ctrlKey;
                        if (isCtrlKey) {
                            e.stopImmediatePropagation();
                            e.preventDefault();
                        }

                        if (tabIdx > -1) { // already open
                            e.preventDefault();
                            e.stopPropagation();
                            closeTab();
                            selectTab(ci2);
                        } else {
                            if (isCtrlKey) { // open new tab
                                li.removeClass('open');
                                li.tooltip('hide');
                                addCurrentCubeTab();
                            } else { // use current tab
                                tabIdx = getOpenCubeIndex(cubeInfo);
                                cubeInfo[CUBE_INFO.TAB_VIEW] = getActiveTabViewType();
                                _openCubes[tabIdx].cubeKey = cia2;
                                localStorage[OPEN_CUBES] = JSON.stringify(_openCubes);
                                li.attr('id', cia2.replace(/\./g,'_'));
                                var img = link.find('img');
                                if (img.length > 0) {
                                    img.attr('src', menuOption.imgSrc);
                                }
                                li.find('a').removeClass(CLASS_ACTIVE_VIEW);
                                $(this).addClass(CLASS_ACTIVE_VIEW);
                            }
                            switchTabPane(getActiveTabViewType());
                        }
                    });

                dd.append($('<li/>').append(anc));
            })();
        }

        dd.append(
            $('<div/>').addClass('divider')
        ).append(
            $('<li/>')
                .addClass('dropdown-submenu')
                .append(
                $('<a/>')
                    .prop({href:'#', tabindex:'-1'})
                    .html('Compare')
            ).append(
                createBranchesUl(function(branchName) {
                    var infoDto = _cubeList[cubeInfo[CUBE_INFO.NAME].toLowerCase()];
                    var leftInfoDto = $.extend(true, {}, infoDto);
                    leftInfoDto.branch = branchName;
                    diffCubes(leftInfoDto, infoDto, infoDto.name);
                })
            )
        ).append(
            $('<li/>')
                .append(
                $('<a/>')
                    .attr('href','#')
                    .html('Revision History...')
                    .click(function(e) {
                        revisionHistory();
                    }))
        ).append(
            $('<li/>')
                .append(
                $('<a/>')
                    .attr('href','#')
                    .html('Show Outbound References')
                    .click(function(e) {
                        showRefsFromCube();
                    }))
        ).append(
            $('<li/>')
                .append(
                $('<a/>')
                    .attr('href','#')
                    .html('Show Required Scopes')
                    .click(function(e) {
                        showReqScope();
                    }))
        ).append(
            $('<div/>').addClass('divider')
        ).append(
            $('<li/>')
                .append(
                $('<a/>')
                    .attr('href','#')
                    .html('Commit...')
                    .click(function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        li.find('li').not($(this).parent()).find('button').remove();
                        var buttons = $(this).find('button');
                        if (buttons.length === 0) {
                            $(this).append(
                                $('<button/>')
                                    .addClass('btn btn-danger btn-xs pull-right')
                                    .html('Cancel')
                            ).append(
                                $('<button/>')
                                    .addClass('btn btn-primary btn-xs pull-right')
                                    .html('Confirm')
                                    .click(function (e) {
                                        closeTab();
                                        var infoDto = _cubeList[cubeInfo[CUBE_INFO.NAME].toLowerCase()];
                                        callCommit([infoDto], true);
                                    })
                            );
                        } else {
                            buttons.remove();
                        }
                    }))
        ).append(
            $('<li/>')
                .append(
                $('<a/>')
                    .attr('href','#')
                    .html('Rollback...')
                    .click(function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        li.find('li').not($(this).parent()).find('button').remove();
                        var buttons = $(this).find('button');
                        if (buttons.length === 0) {
                            $(this).append(
                                $('<button/>')
                                    .addClass('btn btn-danger btn-xs pull-right')
                                    .html('Cancel')
                            ).append(
                                $('<button/>')
                                    .addClass('btn btn-primary btn-xs pull-right')
                                    .html('Confirm')
                                    .click(function (e) {
                                        closeTab();
                                        var infoDto = _cubeList[cubeInfo[CUBE_INFO.NAME].toLowerCase()];
                                        callRollback([infoDto]);
                                    })
                            );
                        } else {
                            buttons.remove();
                        }
                    }))
        ).append(
            $('<li/>')
                .addClass('dropdown-submenu')
                .append(
                $('<a/>')
                    .prop({href:'#', tabindex:'-1'})
                    .html('Update')
                ).append(
                    createBranchesUl(function(branchName) {
                        callUpdate(branchName);
                    })
            )
        ).append(
            $('<div/>')
                .addClass('divider')
        ).append(
            $('<li/>')
                .append(
                $('<a/>')
                    .attr('href','#')
                    .html('Delete...')
                    .click(function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        li.find('li').not($(this).parent()).find('button').remove();
                        var buttons = $(this).find('button');
                        if (buttons.length === 0) {
                            $(this).append(
                                $('<button/>')
                                    .addClass('btn btn-danger btn-xs pull-right')
                                    .html('Cancel')
                            ).append(
                                $('<button/>')
                                    .addClass('btn btn-primary btn-xs pull-right')
                                    .html('Confirm')
                                    .click(function (e) {
                                        closeTab();
                                        var infoDto = _cubeList[cubeInfo[CUBE_INFO.NAME].toLowerCase()];
                                        callDelete([infoDto.name]);
                                    })
                            );
                        } else {
                            buttons.remove();
                        }
                    }))
        ).append(
            $('<li/>')
                .append(
                $('<a/>')
                    .attr('href','#')
                    .html('Duplicate...')
                    .click(function(e) {
                        dupeCube();
                    }))
        ).append(
            $('<li/>')
                .append(
                $('<a/>')
                    .attr('href','#')
                    .html('Rename')
                    .click(function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!ensureModifiable('Unable to rename cube.')) {
                            return;
                        }
                        var parent = $(this).parent();
                        var inputs = parent.find('input');
                        if (inputs.length === 0) {
                            var newNameInput = $('<input/>')
                                .prop({type: 'text', placeholder: cubeInfo[CUBE_INFO.NAME]})
                                .addClass('form-control')
                                .click(function (ie) {
                                    ie.preventDefault();
                                    ie.stopPropagation();
                                })
                                .keyup(function(ie) {
                                    if (ie.keyCode === KEY_CODES.ENTER) {
                                        closeTab();
                                        renameCube(newNameInput.val());
                                    }
                                });
                            parent.append(newNameInput);
                            $(this).append(
                                $('<button/>')
                                    .addClass('btn btn-danger btn-xs pull-right')
                                    .html('Cancel')
                            ).append(
                                $('<button/>')
                                    .addClass('btn btn-primary btn-xs pull-right')
                                    .html('Confirm')
                                    .click(function (e) {
                                        closeTab();
                                        renameCube(newNameInput.val());
                                    })
                            );
                            newNameInput[0].focus();
                        } else {
                            inputs.remove();
                            parent.find('button').remove();
                        }
                    }))
        ).append(
            $('<div/>')
                .prop({'class': 'divider'})
        ).append(
            $('<li/>').append(
                $('<a/>')
                    .attr('href','#')
                    .html('Close')
                    .click(function() {
                        li.tooltip('destroy');
                        removeTab(cubeInfo);
                    }))
        ).append(
            $('<li/>').append(
                $('<a/>')
                    .attr('href','#')
                    .html('Close All')
                    .click(function() {
                        li.tooltip('destroy');
                        removeAllTabs();
                        switchTabPane(null);
                    }))
        ).append(
            $('<li/>').append(
                $('<a/>')
                    .attr('href','#')
                    .html('Close Others')
                    .click(function() {
                        li.tooltip('destroy');
                        removeAllTabs();
                        addCurrentCubeTab();
                    }))
        );

        li.append(link);
        li.append(dd);
        _openTabList.first().append(li);

        trimText(li.find('.tab-text')[0]);
    }

    function trimText(el){
        if (el.scrollWidth > el.offsetWidth) {
            var value = el.innerHTML;
            do {
                value = '...' + value.substr(4);
                el.innerHTML = value;
            }
            while (el.scrollWidth > el.offsetWidth);
        }
    }

    function createBranchesUl(func) {
        var branchNames = getBranchNames();
        var branchesUl = $('<ul/>').addClass('dropdown-menu');
        for (var bnIdx = 0, bnLen = branchNames.length; bnIdx < bnLen; bnIdx++) {
            (function() {
                var branchName = branchNames[bnIdx];
                branchesUl.append($('<li/>').append(
                        $('<a/>').attr('href', '#').html(branchName).click(function () {
                            return func(branchName);
                        })
                    )
                );
            })();
        }
        return branchesUl;
    }

    function switchTabPane(pageId)
    {
        $('.tab-pane').removeClass('active');
        if (pageId) {
            $('#' + pageId).addClass('active');
            var iframeId = 'iframe_' + pageId;
            try {
                var frame = document.getElementById(iframeId);
                if (frame) {
                    var cw = frame.contentWindow;
                    if (cw.tabActivated !== undefined) {
                        cw.tabActivated(buildAppState());
                        localStorage[ACTIVE_TAB_VIEW_TYPE] = pageId;
                    }
                }
            } catch (e) {
                console.log(e);
            }
        }
    }

    function updateTabStatus() {
        var allStatusClasses = [CLASS_OUT_OF_SYNC, CLASS_CONFLICT];
        function updateElementStatus(el, status) {
            el = $(el);
            el.removeClass(allStatusClasses);
            if (status !== undefined && status !== null) {
                el.addClass(status);
            }
        }

        // top tabs
        var tabs = _openTabList.find('li').find('a.ncube-tab-top-level');
        for (var tabNum = 0, tabLen = tabs.length; tabNum < tabLen; tabNum++) {
            updateElementStatus(tabs[tabNum], _openCubes[tabNum].status);
        }

        // overflow
        var overflow = _tabOverflow.find('li').find('a');
        for (var oNum = 0, oLen = overflow.length; oNum < oLen; oNum++) {
            updateElementStatus(overflow[oNum], _openCubes[tabNum + oNum]);
        }
    }

    function calcMaxTabs() {
        var windowWidth = $('#ncube-tabs').width();
        var availableWidth = windowWidth - _tabOverflow.outerWidth();
        return Math.floor(availableWidth / TAB_WIDTH);
    }

    function buildTabs() {
        _openTabList.children().remove();
        _tabOverflow.hide();
        var len = _openCubes.length;
        if (len > 0) {
            var maxTabs = calcMaxTabs();

            var cubeInfo = [_selectedApp, _selectedVersion, _selectedStatus, _selectedBranch, _selectedCubeName, getActiveTabViewType()];
            var idx = getOpenCubeIndex(cubeInfo);
            if (idx >= maxTabs) { // if selected tab is now in overflow, bring to front
                var temp = _openCubes.splice(idx, 1);
                _openCubes.unshift(temp[0]);
                localStorage[OPEN_CUBES] = JSON.stringify(_openCubes);
            }

            for (var i = 0; i < len && i < maxTabs; i++) {
                var openCube = _openCubes[i];
                addTab(openCube.cubeKey.split(TAB_SEPARATOR), openCube.status);
            }
            if (len > maxTabs) {
                _tabOverflow.show();
                buildTabOverflow(maxTabs, len);
            }
            selectTab(cubeInfo);
        }
    }

    function buildTabOverflow(maxTabs, len) {
        $('#tab-overflow-text')[0].innerHTML = len - maxTabs;
        var dd = _tabOverflow.find('ul');
        var largestText = TAB_WIDTH;

        for (var i = maxTabs; i < len; i++) {
            (function() {
                var openCube = _openCubes[i];
                var cubeInfo = openCube.cubeKey.split(TAB_SEPARATOR);
                var imgSrc;
                for (var x = 0, xLen = _menuOptions.length; x < xLen; x++) {
                    var opt = _menuOptions[x];
                    if (opt.pageId === cubeInfo[CUBE_INFO.TAB_VIEW]) {
                        imgSrc = opt.imgSrc;
                        break;
                    }
                }

                var tabText = cubeInfo.slice(0, CUBE_INFO.TAB_VIEW).join(' - ');
                _hiddenCell[0].innerHTML = tabText;
                var textWidth = _hiddenCell.width();
                if (textWidth > largestText) {
                    largestText = textWidth;
                }

                dd.append(
                    $('<li/>').append(
                        $('<a/>')
                            .attr('href', '#')
                            .addClass(openCube.status)
                            .html(getTabImage(imgSrc)
                                + '<span class="dropdown-tab-text">' + tabText + '</span>'
                                + '<span class="glyphicon glyphicon-remove tab-close-icon" aria-hidden="true"></span>'
                            )
                            .click(function(e) {
                                if ($(e.target).hasClass('glyphicon-remove')) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    removeTab(cubeInfo);
                                } else {
                                    makeCubeInfoActive(cubeInfo);
                                    buildTabs();
                                }
                            })
                    )
                );
            })();
        }

        largestText += TAB_OVERFLOW_TEXT_PADDING;
        var button = _tabOverflow.find('button');
        var offset = button.offset();
        var maxWidth = offset.left + button.outerWidth();
        var dropdownWidth = largestText < maxWidth ? largestText : maxWidth;
        var dropDownTop = offset.top + button.outerHeight() + parseInt(button.css('marginTop').replace('px',''));
        var dropDownLeft = maxWidth - dropdownWidth;
        dd.css({top: dropDownTop + 'px', left: dropDownLeft + 'px', width: dropdownWidth + 'px'});
    }

    function buildMenu()
    {
        var result = call('ncubeController.getMenu',[getAppId()]);
        if (result.status !== true)
        {
            showNote('Unable to load menu.' + result.data);
            return;
        }
        var menu = result.data;
        $('#appTitle')[0].innerHTML = menu[CONFIG_TITLE];
        _defaultTab = menu[CONFIG_DEFAULT_TAB];
        if (_defaultTab) {
            _defaultTab = _defaultTab.replace(/\s/g,'_') + PAGE_ID;
            if (!_activeTabViewType) {
                setActiveTabViewType(_defaultTab);
            }
        }
        var ul = $('#menuList');
        ul.empty();
        _menuOptions = [];
        $.each(menu, function (key, value)
        {
            if (!key.startsWith('~') && !key.startsWith('@') && !key.startsWith('#'))
            {
                var pageId = key.replace(/\s/g,'_') + PAGE_ID;
                _menuOptions.push({key:key, pageId:pageId, imgSrc:value['img']});
                if (!_activeTabViewType) {
                    setActiveTabViewType(pageId);
                    _defaultTab = pageId;
                }

                var div = $('<div/>').prop({class:'tab-pane', id:pageId});
                var tabHeight = $('#ncube-tabs').outerHeight();
                div.attr({style:'overflow:hidden;height:calc(100% - ' + tabHeight + 'px);'});
                _mainTabPanel.append(div);

                var iframeId = 'iframe_' + pageId;
                var iframe = $('<iframe id="' + iframeId + '"/>');
                div.append(iframe);

                var html = value['html'];
                if (!html.startsWith('http:') && !html.startsWith('https:'))
                {
                    html += '?appId=' + JSON.stringify(getAppId());
                }
                iframe.attr({style:'position:relative;height:100%;width:100%', src:html});
            }
        });
    }

    function getCubeMap()
    {
        return _cubeList;
    }

    function buildAppState()
    {
        return {
            call: call,
            clearError: clearError,
            displayMap: displayMap,
            doesCubeExist: doesCubeExist,
            ensureModifiable: ensureModifiable,
            exec: exec,
            getAppId: getAppId,
            getCubeMap: getCubeMap,
            getProperCubeName: getProperCubeName,
            getSelectedCubeName: getSelectedCubeName,
            getSelectedApp: getSelectedApp,
            getSelectedVersion: getSelectedVersion,
            getSelectedStatus: getSelectedStatus,
            isHeadSelected: isHeadSelected,
            loadCube: loadCube,
            reloadCube: reloadCube,
            selectBranch: selectBranch,
            selectCubeByName: selectCubeByName,
            showNote: showNote,
            loadNCubes: loadNCubes,
            loadNCubeListView: loadNCubeListView
        };
    }

    function reloadCube()
    {
        var doc = document.documentElement;
        var left = (window.pageXOffset || doc.scrollLeft) - (doc.clientLeft || 0);
        var top = (window.pageYOffset || doc.scrollTop) - (doc.clientTop || 0);
        loadCube();
        window.scrollTo(left, top);
    }

    function clearSearch()
    {
        _searchNames.val('');
        _searchContent.val('');
        loadNCubeListView();
        setListSelectedStatus(_selectedCubeName, '#ncube-list');
        _searchNames.val('');
        _searchContent.val('');
        _cubeCount[0].textContent = Object.keys(_cubeList).length;
    }

    function selectCubeByName(cubeName)
    {
        if (!cubeName) {
            return;
        }
        _selectedCubeName = getProperCubeName(cubeName);
        localStorage[SELECTED_CUBE] = cubeName;

        var cubeInfo = [_selectedApp, _selectedVersion, _selectedStatus, _selectedBranch, _selectedCubeName];
        var cis = cubeInfo.join(TAB_SEPARATOR);
        var found = false;
        for (var i = 0, len = _openCubes.length; i < len; i++) {
            var oci = _openCubes[i].cubeKey;
            var idx = oci.lastIndexOf(TAB_SEPARATOR);
            var tab = oci.substring(idx + TAB_SEPARATOR.length);
            oci = oci.substring(0, idx);

            if (oci === cis) {
                cubeInfo.push(tab);

                if (i < calcMaxTabs()) {
                    selectTab(cubeInfo);
                } else {
                    makeCubeInfoActive(cubeInfo);
                    buildTabs();
                    return;
                }
                found = true;
                break;
            }
        }
        if (!found) {
            setActiveTabViewType(_defaultTab);
            addCurrentCubeTab();
        }
        saveState();
    }

    function runSearch()
    {
        if (!_searchContent.val() || _searchContent.val() == '')
        {   // Perform filter client-side only (no server call)
            var mainList = _cubeList;
            if (_searchNames.val() && _searchNames.val() != '')
            {   // If there is content to filter by, then use it.
                var nameFilter = _searchNames.val();
                var list = [];
                var pattern = wildcardToRegexString(nameFilter);
                var regex = new RegExp(pattern, "i");

                $.each(_cubeList, function (key, info)
                {
                    var array = regex.exec(key);
                    if (array)
                    {
                        info.pos = array.index;
                        info.endPos = array.index + array[0].length;
                        list.push(info);
                    }
                });

                list.sort(function (a, b)
                {
                    if (a.pos < b.pos)
                        return -1;
                    if (a.pos > b.pos)
                        return 1;

                    return a.name.localeCompare(b.name);
                });

                mainList = {};
                for (var i = 0; i < list.length; i++)
                {
                    var info = list[i];
                    mainList[info.name.toLowerCase()] = info;
                }
                list = [];
            }
            loadFilteredNCubeListView(mainList);
        }
        else
        {   // Do server side search as content was specified
            _searchThread.postMessage(
                [
                    _searchNames.val(),
                    _searchContent.val(),
                    {
                        "app": _selectedApp,
                        "version": _selectedVersion,
                        "status": _selectedStatus,
                        "branch": _selectedBranch
                    }
                ]);
        }
    }

    function setCubeListLoading()
    {
        _listOfCubes.empty();
        var anchor = $('<a/>');
        anchor[0].textContent = 'Loading n-cubes...';
        _listOfCubes.append(anchor);
    }

    // Clear versions (add single 'Loading versions...' entry)
    function setVersionListLoading()
    {
        var select = $('#version-list');
        select.empty();
        var option = $('<option/>');
        option[0].textContent = 'Loading versions...';
        select.append(option);
    }

    function addListeners()
    {
        // 'Close' for the Diff Modal
        $('#diffModalClose').click(function() {
            _diffModal.css('display', 'none');
        });

        $('#diffDesc').click(function() {
            diffLoad(DIFF_DESCRIPTIVE)
        });
        $('#diffVisual').click(function() {
            diffLoad(DIFF_VISUAL)
        });
        $('#diffSide').click(function() {
            diffLoad(DIFF_SIDE_BY_SIDE)
        });
        $('#diffInline').click(function() {
            diffLoad(DIFF_INLINE)
        });

        // Send to background Web Worker thread
        _searchNames.on('input', function (event)
        {
            _searchKeyPressed = true;
            _searchLastKeyTime = Date.now();
        });
        _searchContent.on('input', function (event)
        {
            _searchKeyPressed = true;
            _searchLastKeyTime = Date.now();
        });

        _searchNames.keyup(function (e)
        {
            if (e.keyCode === KEY_CODES.ESCAPE)
            {   // ESCape key
                clearSearch();
            }
        });

        _searchContent.keyup(function (e)
        {
            if (e.keyCode === KEY_CODES.ESCAPE)
            {   // ESCape key
                clearSearch();
            }
        });

        // Selection listener for application change
        $('#app-list').change(function (e)
        {
            var appName = e.target.value;
            localStorage[SELECTED_APP] = appName;
            _selectedApp = appName;

            setVersionListLoading();
            setCubeListLoading();

            setTimeout(function()
            {   // Allow selection widget to update before loading content
                loadVersions();
                loadVersionListView();
                loadNCubes();
                loadNCubeListView();
                runSearch();
                buildMenu();
            }, PROGRESS_DELAY);
        });

        // Selection listener for version number change
        $('#version-list').change(function (e)
        {
            var version = e.target.value;
            localStorage[SELECTED_VERSION] = version;
            _selectedVersion = version;

            setCubeListLoading();

            setTimeout(function()
            {   // Allow bootstrap-selection widget to update before loading content
                loadNCubes();
                loadNCubeListView();
                runSearch();
                buildMenu();
            }, PROGRESS_DELAY);
        });

        // Set up back button support (base a page on a app, version, status, branch, and cube name)
        $(window).on("popstate", function(e)
        {
            var state = e.originalEvent.state;

            if (state)
            {
                _selectedCubeName = state.cube;
                if (_selectedApp == state.app &&
                    _selectedVersion == state.version &&
                    _selectedStatus == state.status &&
                    _selectedBranch == state.branch)
                {   // Make Back button WAY faster when only cube name changes - no need to reload other lists.
                    selectCubeByName(_selectedCubeName);
                }
                else
                {
                    _selectedApp = state.app;
                    _selectedVersion = state.version;
                    _selectedStatus = state.status;
                    _selectedCubeName = state.cube;
                    _selectedBranch = state.branch;
                    showActiveBranch();
                    loadAppNames();
                    loadVersions();
                    loadNCubes();
                    loadAppListView();
                    loadStatusListView();
                    loadVersionListView();
                    selectCubeByName(_selectedCubeName);
                    buildMenu();
                }
            }
        });

        $('#cube-search-reset').click(function()
        {
            clearSearch();
        });
        $('#newCubeMenu').click(function ()
        {
            newCube()
        });
        $('#newCubeSave').click(function ()
        {
            newCubeSave()
        });
        $('#renameCubeOk').click(function ()
        {
            renameCubeOk();
        });
        $('#dupeCubeCopy').click(function ()
        {
            dupeCubeCopy();
        });
        $('#deleteCubeMenu').click(function ()
        {
            deleteCube();
        });
        $('#deleteSelectAll').click(function()
        {
            checkAll(true, 'input[type="checkbox"]');
        });
        $('#deleteSelectNone').click(function()
        {
            checkAll(false, 'input[type="checkbox"]');
        });
        $('#deleteCubeOk').click(function ()
        {
            deleteCubeOk();
        });
        $('#restoreCubeMenu').click(function ()
        {
            restoreCube();
        });
        $('#restoreCubeOk').click(function ()
        {
            restoreCubeOk();
        });
        $('#restoreSelectAll').click(function()
        {
            checkAll(true, 'input[type="checkbox"]');
        });
        $('#restoreSelectNone').click(function()
        {
            checkAll(false, 'input[type="checkbox"]');
        });
        $('#revisionHistoryOk').click(function ()
        {
            revisionHistoryOk();
        });
        $('#showRefsFromClose').click(function ()
        {
            showRefsFromCubeClose()
        });
        $('#showReqScopeClose').click(function ()
        {
            showReqScopeClose()
        });
        $('#releaseCubesMenu').click(function ()
        {
            releaseCubes()
        });
        $('#releaseCubesOk').click(function ()
        {
            releaseCubesOk()
        });
        $('#changeVerMenu').click(function ()
        {
            changeVersion()
        });
        $('#changeVerOk').click(function ()
        {
            changeVersionOk()
        });
        $('#clearStorage').click(function()
        {
            clearStorage();
        });
        $('#clearCache').click(function()
        {
            clearCache();
        });
        $('#serverStats').click(function()
        {
            serverStats();
        });
        $('#httpHeaders').click(function()
        {
            httpHeaders();
        });
        $('#compareRevs').click(function()
        {
            compareRevisions();
        });
        $('#promoteRev').click(function() {
            promoteRevision();
        });
        $('#clearRevSelection').click(function()
        {
            clearRevSelection();
        });

        addBranchListeners();
    }

    function loadAppListView()
    {
        $('#appCount')[0].textContent = _apps.length;  // update no. applications badge
        var select = $('#app-list');
        select.empty();

        $.each(_apps, function (index, value)
        {
            var option = $("<option/>");
            option[0].textContent = value;
            select.append(option);
        });

        if (_selectedApp)
        {
            select.val(_selectedApp);
        }
    }

    function saveState()
    {
        var title = (_selectedApp ? _selectedApp : '') + ' - ' + (_selectedVersion ? _selectedVersion : '') + ' - ' + (_selectedStatus ? _selectedStatus : '') + ' - ' + (_selectedBranch ? _selectedBranch : '') + ' - ' + (_selectedCubeName ? _selectedCubeName : '');
        document.title = title;
        var state = history.state;
        if (state && state.app == _selectedApp &&
            state.version == _selectedVersion &&
            state.status == _selectedStatus &&
            state.branch == _selectedBranch &&
            state.cube == _selectedCubeName)
        {   // Don't save redundant selection
            return;
        }
        history.pushState({app: _selectedApp,
            version: _selectedVersion,
            status: _selectedStatus,
            branch: _selectedBranch,
            cube: _selectedCubeName}, title);
    }

    function loadStatusListView()
    {
        var list = $('#status-list');
        list.empty();
        $.each(_statuses, function (index, value)
        {
            var li = $("<li/>");
            var anchor = $('<a href="#"/>');
            anchor.click(function ()
            {
                var status = anchor[0].textContent;
                setListSelectedStatus(status, '#status-list');
                _selectedStatus = status;
                loadVersions();
                loadVersionListView();
                loadNCubes();
                loadNCubeListView();
                runSearch();
                buildMenu();
            });
            anchor[0].textContent = value;
            li.append(anchor);
            list.append(li);
        });
        setListSelectedStatus(_selectedStatus, '#status-list');
    }

    function loadVersionListView()
    {
        $('#verCount')[0].textContent = _versions.length;  // update number of versions for the selected app
        var select = $('#version-list');
        select.empty();

        $.each(_versions, function (index, value)
        {
            var option = $("<option/>");
            option[0].textContent = value;
            select.append(option);
        });

        if (_selectedVersion)
        {
            select.val(_selectedVersion);
        }
    }

    function getActiveTab()
    {
        return _mainTabPanel.find('div.active iframe');
    }

    function loadNCubeListView()
    {
        loadFilteredNCubeListView(_cubeList);
    }

    function loadFilteredNCubeListView(cubes)
    {
        var filter = _searchNames.val();
        _listOfCubes.empty();
        var count = 0;

        $.each(cubes, function buildCubeList(loName, infoDto)
        {
            count++;
            var cubeName = infoDto.name;
            var li = $('<li/>');
            var a = $('<a href="#"/>');
            a.click(function()
            {
                selectCubeByName(loName);
            });

            if (_selectedCubeName == cubeName)
            {
                a.addClass('ncube-selected').removeClass('ncube-notselected');
            }
            else
            {
                a.addClass('ncube-notselected').removeClass('ncube-selected');
            }

            a.attr('itemName', loName);
            li.append(a);
            _listOfCubes.append(li);


            if (filter && infoDto.pos != null && infoDto.endPos != null)
            {
                var nameHtml = cubeName.substring(0, infoDto.pos);
                nameHtml += '<span class="search-hilite">';
                nameHtml += cubeName.substring(infoDto.pos, infoDto.endPos);
                nameHtml += '</span>';
                nameHtml += cubeName.substring(infoDto.endPos);
                a[0].innerHTML = nameHtml;
            }
            else
            {
                a[0].textContent = cubeName;
            }

            if (!isHeadSelected())
            {
                if (!infoDto.headSha1)
                {
                    a.addClass('cube-added');
                }
                else if (infoDto.headSha1 != infoDto.sha1)
                {
                    a.addClass('cube-modified');
                }
            }
        });

        if (keyCount(cubes) < 1)
        {   // Special case: 0 cubes
            var activeTab = getActiveTab();
            if (activeTab && activeTab[0])
            {   // Indicate to the active iFrame that a cube selection event has occurred.
                activeTab[0].contentWindow.cubeSelected();
            }
        }
        _cubeCount[0].textContent = count;
    }

    function getProperCubeName(cubeName)
    {
        var nameToChk = (cubeName + '').toLowerCase();
        var info = _cubeList[nameToChk];
        return info ? info.name : null;
    }

    function loadCube()
    {
        saveState();
        try
        {
            var activeTab = getActiveTab();
            if (activeTab && activeTab[0])
            {   // Indicate to the active iFrame that a cube selection event has occurred.
                activeTab[0].contentWindow.cubeSelected();
            }
        }
        catch (e)
        {
            console.log(e);
        }

        setListSelectedStatus(_selectedCubeName, '#ncube-list');
    }

    /**
     * Tweak the class name of the selected / non-selected items
     * to match what was selected.
     */
    function setListSelectedStatus(itemName, listId)
    {
        if (itemName == null)
        {
            return;
        }
        var items = $(listId).find('li a');
        var saveSelected = null;
        var loItemName = itemName.toLowerCase();

        $.each(items, function (index, value)
        {
            var anchor = $(value);
            var text = anchor[0].textContent;
            var elemName = anchor.attr('itemName');
            if (loItemName == elemName || itemName == text)
            {
                saveSelected = anchor;
                anchor.removeClass('ncube-notselected').addClass('ncube-selected');
            }
            else
            {
                anchor.removeClass('ncube-selected').addClass('ncube-notselected');
            }
        });

        if (saveSelected)
        {
            saveSelected.scrollintoview();
        }
    }

    /**
     * Load NCube List from Database
     */
    function loadNCubes()
    {
        _cubeList = {};
        if (!_selectedApp)
        {
            return;
        }
        if (!_selectedVersion)
        {
            return;
        }
        if (!_selectedStatus)
        {
            return;
        }
        var result = call("ncubeController.search", [getAppId(), '*', null, true]);
        var first = null;
        if (result.status === true)
        {
            $.each(result.data, function (index, value)
            {
                var name = value.name;
                _cubeList[name.toLowerCase()] = value;
                if (!first)
                {
                    first = name;
                }
            });
        }
        else
        {
            showNote('Unable to load n-cubes:<hr class="hr-small"/>' + result.data);
        }
    }

    function doesCubeExist()
    {
        var nameToChk = (_selectedCubeName + '').toLowerCase();
        return nameToChk in _cubeList;
    }

    function loadVersions()
    {
        _versions = [];
        clearError();
        if (!_selectedApp)
        {
            showNote('Unable to load versions, no n-cube App selected.');
            return;
        }
        if (!_selectedStatus)
        {
            showNote('Unable to load versions, no n-cube Status selected.');
            return;
        }
        if (!_selectedBranch)
        {
            showNote('Unable to load versions, no branch selected.');
            return;
        }

        var result = call("ncubeController.getAppVersions", [_selectedApp, _selectedStatus, _selectedBranch]);
        if (result.status === true)
        {
            $.each(result.data, function (index, value)
            {
                _versions[index] = value;
            });
        }
        else
        {
            showNote('Unable to load versions:<hr class="hr-small"/>' + result.data);
        }
        if (!_selectedVersion || !doesVersionExist(_selectedVersion))
        {
            _selectedVersion = (_versions && _versions.length > 0) ? _versions[_versions.length - 1] : null;
        }
    }

    function doesVersionExist(selVer)
    {
        for (var i=0; i < _versions.length; i++)
        {
            if (_versions[i] == selVer)
            {
                return true;
            }
        }
        return false;
    }

    function loadAppNames()
    {
        _apps = [];
        clearError();
        var result = call("ncubeController.getAppNames", [_selectedStatus, _selectedBranch]);
        if (result.status === true)
        {
            $.each(result.data, function (index, value)
            {
                _apps[index] = value;
            });
        }
        else
        {
            showNote('Unable to load n-cube Apps:<hr class="hr-small"/>' + result.data);
        }
        if (!_selectedApp && _apps)
        {
            _selectedApp = _apps[0];
            localStorage[SELECTED_APP] = _selectedApp;
        }
        if (!_apps)
        {
            _selectedApp = localStorage[SELECTED_APP] = null;
        }
        else if (!doesItemExist(_selectedApp, _apps) && _apps.length > 0)
        {
            _selectedApp = _apps[0];
        }
    }

    function newCube()
    {
        if (isHeadSelected())
        {
            selectBranch();
            return false;
        }

        clearError();
        $('#newCubeAppName').val(_selectedApp);
        $('#newCubeStatus').val('SNAPSHOT');
        $('#newCubeVersion').val(_selectedVersion);
        $('#newCubeName').val('');
        buildDropDown('#newCubeAppList', '#newCubeAppName', _apps, function (app)
        {
            var result = call("ncubeController.getAppVersions", [getAppId()]);
            if (result.status === true)
            {
                buildDropDown('#existVersionList', '#newCubeVersion', result.data, function ()
                {
                });
            }
            else
            {
                showNote('Failed to load App versions:<hr class="hr-small"/>' + result.data);
            }
        });
        buildDropDown('#existVersionList', '#newCubeVersion', _versions, function ()
        {
        });
        $('#newCubeModal').modal();
    }

    function newCubeSave()
    {
        $('#newCubeModal').modal('hide');
        var appName = $('#newCubeAppName').val();
        var cubeName = $('#newCubeName').val();
        var version = $('#newCubeVersion').val();
        if (!version)
        {
            showNote("Note", "Version must be x.y.z")
            return;
        }
        var appId = getAppId();
        appId.version = version;
        appId.app = appName;
        var result = call("ncubeController.createCube", [appId, cubeName]);
        if (result.status === true)
        {
            _selectedApp = appName;
            _selectedVersion = appId.version;
            loadAppNames();
            loadNCubes();
            loadVersions();
            loadAppListView();
            loadStatusListView();
            loadVersionListView();
            loadNCubeListView();
            clearSearch();
            selectCubeByName(cubeName);
        }
        else
        {
            showNote("Unable to create n-cube '" + cubeName + "':<hr class=\"hr-small\"/>" + result.data);
        }
    }

    function deleteCube()
    {
        clearError();
        if (!_selectedApp || !_selectedVersion || !_selectedStatus) {
            showNote('Need to have an application, version, and status selected first.');
            return;
        }
        if (isHeadSelected()) {
            selectBranch();
            return;
        }

        var ul = $('#deleteCubeList');
        ul.empty();
        $('#deleteCubeLabel')[0].textContent = 'Delete Cubes in ' + _selectedVersion + ', ' + _selectedStatus;
        var cubeLinks = _listOfCubes.find('a');
        for (var i = 0, len = cubeLinks.length; i < len; i++) {
            var cubeName = cubeLinks[i].textContent;
            var li = $('<li/>').prop({class: 'list-group-item skinny-lr'});
            var div = $('<div/>').prop({class: 'container-fluid'});
            var checkbox = $('<input>').prop({
                class: 'deleteCheck',
                type: 'checkbox'
            });
            var label = $('<label/>').prop({class: 'checkbox no-margins'});
            label[0].textContent = cubeName;
            checkbox.prependTo(label); // <=== create input without the closing tag
            div.append(label);
            li.append(div);
            ul.append(li);
        }
        $('#deleteCubeModal').modal();
    }

    function deleteCubeOk() {
        $('#deleteCubeModal').modal('hide');

        var input = $('.deleteCheck');
        var cubesToDelete = [];
        $.each(input, function (index, label) {
            if ($(this).is(':checked')) {
                cubesToDelete.push($(this).parent()[0].textContent);
            }
        });

        callDelete(cubesToDelete);
    }

    function callDelete(cubesToDelete) {
        var result = call("ncubeController.deleteCubes", [getAppId(), cubesToDelete]);
        if (result.status === true) {
            var cubeInfo = [];
            cubeInfo[CUBE_INFO.APP] = _selectedApp;
            cubeInfo[CUBE_INFO.VERSION] = _selectedVersion;
            cubeInfo[CUBE_INFO.STATUS] = _selectedStatus;
            cubeInfo[CUBE_INFO.BRANCH] = _selectedBranch;
            for (var i = 0, len = cubesToDelete.length; i < len; i++) {
                var cubeName = cubesToDelete[i];
                delete _cubeList[cubeName.toLowerCase()];
                if (_selectedCubeName === cubeName) {
                    _selectedCubeName = null;
                    _activeTabViewType = null;
                    delete localStorage[SELECTED_CUBE];
                    delete localStorage[ACTIVE_TAB_VIEW_TYPE];
                }

                cubeInfo[CUBE_INFO.NAME] = cubeName;

                var cis = cubeInfo.join(TAB_SEPARATOR);
                for (var x = _openCubes.length - 1; x >= 0; x--) {
                    if (_openCubes[x].cubeKey.indexOf(cis) > -1) {
                        _openCubes.splice(x, 1);
                    }
                }
            }
            localStorage[OPEN_CUBES] = JSON.stringify(_openCubes);
            buildTabs();
            loadNCubeListView();
            runSearch();
        } else {
            showNote("Unable to delete cubes: " + '<hr class="hr-small"/>' + result.data);
        }
    }

    function restoreCube()
    {
        clearError();
        if (!_selectedApp || !_selectedVersion || !_selectedStatus)
        {
            showNote('Need to have an application, version, and status selected first.');
            return;
        }
        if (isHeadSelected())
        {
            selectBranch();
            return;
        }

        var ul = $('#deletedCubeList');
        ul.empty();
        $('#restoreCubeLabel')[0].textContent = 'Restore Cubes in ' + _selectedVersion + ', ' + _selectedStatus;
        var result = call("ncubeController.search", [getAppId(), "*", null, false]);
        if (result.status === true)
        {
            $.each(result.data, function (index, value)
            {
                var li = $('<li/>').prop({class: 'list-group-item skinny-lr'});
                var div = $('<div/>').prop({class:'container-fluid'});
                var checkbox = $('<input>').prop({class:'restoreCheck', type:'checkbox'});
                var label = $('<label/>').prop({class: 'checkbox no-margins'});
                label[0].textContent = value.name;
                checkbox.prependTo(label); // <=== create input without the closing tag
                div.append(label);
                li.append(div);
                ul.append(li);
            });
            $('#restoreCubeModal').modal();
        }
        else
        {
            showNote('Error fetching deleted cubes (' + _selectedVersion + ', ' + _selectedStatus + '):<hr class="hr-small"/>' + result.data);
        }
    }

    function restoreCubeOk()
    {
        $('#restoreCubeModal').modal('hide');

        var input = $('.restoreCheck');
        var cubesToRestore = [];
        $.each(input, function (index, label)
        {
            if ($(this).is(':checked'))
            {
                cubesToRestore.push($(this).parent()[0].textContent);
            }
        });

        var result = call("ncubeController.restoreCubes", [getAppId(), cubesToRestore]);
        if (result.status === true)
        {
            loadNCubes();
            loadNCubeListView();
            var cubeName = _selectedCubeName;
            if (cubesToRestore.length == 1)
            {
                cubeName = cubesToRestore[0];
                selectCubeByName(cubeName);
            }
            clearSearch();
        }
        else
        {
            showNote("Unable to restore cubes':<hr class=\"hr-small\"/>" + result.data);
        }
    }

    function revisionHistory()
    {
        clearError();
        if (!_selectedApp || !_selectedVersion || !_selectedCubeName || !_selectedStatus)
        {
            showNote('No n-cube selected. No revision history to show.');
            return;
        }
        var ul = $('#revisionHistoryList');
        ul.empty();
        $('#revisionHistoryLabel')[0].textContent = 'Revision History for ' + _selectedCubeName;
        $('#revisionHistoryModal').modal();

        var result = call("ncubeController.getRevisionHistory", [getAppId(), _selectedCubeName]);

        if (result.status === true)
        {
            $.each(result.data, function (index, infoDto)
            {
                var li = $("<li/>").attr({'class': 'list-group-item skinny-lr'});
                var anchorHtml = $('<a href="#" style="margin:0 10px 0 0"/>');
                var anchorJson = $('<a href="#" style="margin:0 10px 0 0"/>');

                var kbd1 = $('<kbd/>');
                kbd1[0].textContent = 'HTML';
                anchorHtml.append(kbd1);

                var kbd2 = $('<kbd/>');
                kbd2[0].textContent = 'JSON';
                anchorJson.append(kbd2);

                li.append(anchorHtml);
                li.append(anchorJson);

                var labelB = $('<label/>').prop({class: 'col-xs-1'});
                labelB.css('padding', 0);
                labelB.css('margin', 0);
                labelB.css('margin-right', '10px');
                labelB.css('width', '12%');
                labelB.append(anchorHtml);
                labelB.append(anchorJson);

                var div = $('<div/>').prop({class: 'container-fluid'});
                var checkbox = $('<input>').prop({class:'commitCheck', type:'checkbox'});
                checkbox.attr('data-cube-id', infoDto.id);
                checkbox.attr('data-rev-id', infoDto.revision);
                var label = $('<label/>').prop({class: 'checkbox no-margins col-xs-10'});
                var text = 'rev: ' + infoDto.revision + '&nbsp;&nbsp;&nbsp;';
                if (infoDto.notes && infoDto.notes != "")
                {
                    text += infoDto.notes;
                }
                else
                {
                    var date = '';
                    if (infoDto.createDate != undefined)
                    {
                        date = new Date(infoDto.createDate).format('yyyy-mm-dd HH:MM:ss');
                    }
                    text += date + '&nbsp;&nbsp;&nbsp;' + infoDto.createHid;
                }
                label[0].innerHTML = text;
                checkbox.prependTo(label);
                div.append(labelB);
                div.append(label);
                li.append(div);

                anchorHtml.click(function ()
                {
                    var title = infoDto.name + '.rev.' + infoDto.revision;
                    var oldHtml = window.open('', title + '.html');
                    var htmlReq = call("ncubeController.loadCubeById", [getAppId(), infoDto.id, "html"], {noResolveRefs:true});
                    if (htmlReq.status === true)
                    {
                        oldHtml.document.removeChild(oldHtml.document.documentElement);
                        oldHtml.document.write(htmlReq.data);
                        oldHtml.document.title = title + '.html';
                    }
                });
                anchorJson.click(function ()
                {
                    var title = infoDto.name + '.rev.' + infoDto.revision;
                    var oldJson = window.open('', title + '.json');
                    var prettyJsonReq = call("ncubeController.loadCubeById", [getAppId(), infoDto.id, "json-pretty"], {noResolveRefs:true});
                    if (prettyJsonReq.status === true)
                    {
                        oldJson.document.removeChild(oldJson.document.documentElement);
                        oldJson.document.write('<html><pre>');
                        oldJson.document.write(prettyJsonReq.data);
                        oldJson.document.write('</pre></html>');
                        oldJson.document.title = title + '.json';
                    }
                });
                ul.append(li);
            });
        }
        else
        {
            showNote('Error fetching revision history (' + _selectedVersion + ', ' + _selectedStatus + '):<hr class="hr-small"/>' + result.data);
        }
    }

    function getSelectedRevisions() {
        var cubeIds = [];
        var revIds = [];
        $.each($('#revisionHistoryList').find('.commitCheck:checked'), function()
        {
            cubeIds.push($(this).attr('data-cube-id'));
            revIds.push($(this).attr('data-rev-id'))
        });

        return {cubeIds:cubeIds, revIds:revIds};
    }

    function compareRevisions()
    {
        var revs = getSelectedRevisions();
        var revIds = revs.revIds;
        var cubeIds = revs.cubeIds;

        if (revIds.length != 2)
        {
            showNote('Must select exactly 2 for comparison', 'Note', 2500);
            return;
        }

        if (revIds[0] < revIds[1])
        {
            var loIdx = 0;
            var hiIdx = 1;
        }
        else
        {
            var loIdx = 1;
            var hiIdx = 0;
        }
        diffCubeRevs(cubeIds[loIdx], cubeIds[hiIdx], revIds[loIdx], revIds[hiIdx], revIds[loIdx] + ' vs. ' + revIds[hiIdx]);
    }

    function promoteRevision() {
        var revs = getSelectedRevisions();
        var revIds = revs.revIds;

        var note;
        if (revIds.length == 0) {
            note = 'Must select a revision to promote.';
        } else if (revIds.length > 1) {
            note = 'Must select only 1 revision to promote.';
        }
        if (note) {
            showNote(note, 'Note', 2500);
            return;
        }

        var result = call("ncubeController.promoteRevision", [getAppId(), revs.cubeIds[0]]);

        if (result.status === true) {
            loadCube();
            revisionHistoryOk();
        } else {
            showNote("Unable to promote n-cube '" + _selectedCubeName + "':<hr class=\"hr-small\"/>" + result.data);
        }
    }

    function clearRevSelection()
    {
       $.each($('#revisionHistoryList').find('.commitCheck:checked'), function()
        {
            $(this).removeAttr("checked");
        });
    }

    function revisionHistoryOk()
    {
        $('#revisionHistoryModal').modal('hide');
    }

    function renameCube(newName) {
        var result = call("ncubeController.renameCube", [getAppId(), _selectedCubeName, newName]);
        if (result.status === true) {
            var oldCubeInfo = [];
            oldCubeInfo[CUBE_INFO.APP] = _selectedApp;
            oldCubeInfo[CUBE_INFO.VERSION] = _selectedVersion;
            oldCubeInfo[CUBE_INFO.STATUS] = _selectedStatus;
            oldCubeInfo[CUBE_INFO.BRANCH] = _selectedBranch;
            oldCubeInfo[CUBE_INFO.NAME] = _selectedCubeName;
            var oldCis = oldCubeInfo.join(TAB_SEPARATOR);

            var newCubeInfo = [];
            newCubeInfo[CUBE_INFO.APP] = _selectedApp;
            newCubeInfo[CUBE_INFO.VERSION] = _selectedVersion;
            newCubeInfo[CUBE_INFO.STATUS] = _selectedStatus;
            newCubeInfo[CUBE_INFO.BRANCH] = _selectedBranch;
            newCubeInfo[CUBE_INFO.NAME] = newName;
            newCubeInfo[CUBE_INFO.TAB_VIEW] = getActiveTabViewType();
            var newCis = newCubeInfo.join(TAB_SEPARATOR);
            for (var i = 0, len = _openCubes.length; i < len; i++) {
                var openCube = _openCubes[i];
                if (openCube.cubeKey.indexOf(oldCis) > -1) {
                    openCube.cubeKey = newCis;
                }
            }
            localStorage[OPEN_CUBES] = JSON.stringify(_openCubes);
            _selectedCubeName = newName;
            localStorage[SELECTED_CUBE] = _selectedCubeName;
            buildTabs();
            loadNCubes();
            loadNCubeListView();
            loadCube();
            runSearch();
        } else {
            showNote("Unable to rename n-cube '" + _selectedCubeName + "':<hr class=\"hr-small\"/>" + result.data);
        }
    }

    function dupeCube()
    {
        clearError();
        if (!_selectedApp || !_selectedVersion || !_selectedCubeName || !_selectedStatus)
        {
            showNote('No n-cube selected. Nothing to duplicate.');
            return;
        }
        if (isHeadSelected())
        {
            selectBranch();
            return false;
        }

        $('#dupeCubeAppName').val(_selectedApp);
        $('#dupeCubeVersion').val(_selectedVersion);
        $('#dupeCubeName').val(_selectedCubeName);
        $('#dupeCubeLabel')[0].textContent = 'Duplicate: ' + _selectedCubeName + ' ?';
        buildDropDown('#dupeCubeAppList', '#dupeCubeAppName', _apps, function (app)
        {
            var appId = {
                'app':app,
                'status':'SNAPSHOT',
                'branch':_selectedBranch
            };
            var result = call("ncubeController.getAppVersions", [_selectedApp, _selectedStatus, _selectedBranch]);
            if (result.status === true)
            {
                buildDropDown('#dupeCubeVersionList', '#dupeCubeVersion', result.data, function ()
                {
                });
            }
            else
            {
                showNote('Unable to load App versions:<hr class="hr-small"/>' + result.data);
            }
        });
        buildDropDown('#dupeCubeVersionList', '#dupeCubeVersion', _versions, function ()
        {
        });
        $('#dupeCubeModal').modal();
    }

    function dupeCubeCopy()
    {
        $('#dupeCubeModal').modal('hide');
        var newName = $('#dupeCubeName').val();
        var newApp = $('#dupeCubeAppName').val();
        var newVersion = $('#dupeCubeVersion').val();
        var destAppId = {
            'app':newApp,
            'version':newVersion,
            'status':'SNAPSHOT',
            'branch':_selectedBranch
        };
        var result = call("ncubeController.duplicateCube", [getAppId(), destAppId, _selectedCubeName, newName]);
        if (result.status === true)
        {
            loadAppNames();
            _selectedApp = newApp;
            loadAppListView();
            _selectedStatus = 'SNAPSHOT';
            setListSelectedStatus('SNAPSHOT', '#status-list');
            loadVersions();
            _selectedVersion = newVersion;
            loadVersionListView();
            loadNCubes();
            clearSearch();
            selectCubeByName(newName);
        }
        else
        {
            showNote("Unable to duplicate n-cube '" + _selectedCubeName + "':<hr class=\"hr-small\"/>" + result.data);
        }
    }

    function showRefsFromCube()
    {
        clearError();
        if (!_selectedApp || !_selectedVersion || !_selectedCubeName || !_selectedStatus)
        {
            showNote('No n-cube selected. No (outbound) references to show.');
            return;
        }
        $('#showRefsFromLabel')[0].textContent = 'Outbound refs of: ' + _selectedCubeName;
        var ul = $('#refsFromCubeList');
        ul.empty();
        $('#showRefsFromCubeModal').modal();
        var result = call("ncubeController.getReferencesFrom", [getAppId(), _selectedCubeName]);
        if (result.status === true)
        {
            $.each(result.data, function (index, value)
            {
                var li = $("<li/>").attr({'class': 'list-group-item skinny-lr'});
                var anchor = $('<a href="#"/>');
                anchor[0].innerHTML = value;
                anchor.click(function ()
                {
                    showRefsFromCubeClose();
                    selectCubeByName(value);
                });
                li.append(anchor);
                ul.append(li);
            });
        }
        else
        {
            showNote('Error fetching outbound references for ' + _selectedCubeName + '):<hr class="hr-small"/>' + result.data);
        }
    }

    function showRefsFromCubeClose()
    {
        $('#showRefsFromCubeModal').modal('hide');
    }

    function showReqScope()
    {
        clearError();
        if (!_selectedApp || !_selectedVersion || !_selectedCubeName || !_selectedStatus)
        {
            showNote('No n-cube selected. No required scope to show.');
            return;
        }
        $('#showReqScopeLabel')[0].textContent = "Scope for '" + _selectedCubeName + "'";
        var ul = $('#reqScopeList');
        ul.empty();
        $('#showReqScopeModal').modal();
        var result = call("ncubeController.getRequiredScope", [getAppId(), _selectedCubeName]);
        if (result.status === true)
        {
            $.each(result.data, function (index, value)
            {
                var li = $("<li/>").attr({'class': 'list-group-item skinny-lr'});
                li[0].innerHTML = value;
                ul.append(li);
            });
        }
        else
        {
            showNote('Error fetching required scope for: ' + _selectedCubeName + '):<hr class="hr-small"/>' + result.data);
        }
    }

    function showReqScopeClose()
    {
        $('#showReqScopeModal').modal('hide');
    }

    function releaseCubes()
    {
        clearError();
        if (!isHeadSelected())
        {
            showNote('HEAD branch must be selected to release a version.');
            return;
        }

        $('#releaseCubesLabel')[0].textContent = 'Release ' + _selectedApp + ' ' + _selectedVersion + ' SNAPSHOT ?';
        $('#releaseCubesAppName').val(_selectedApp);
        $('#releaseCubesModal').modal();
    }

    function releaseCubesOk()
    {
        setTimeout(function() {
            $('#releaseCubesModal').modal('hide');
            var newSnapVer = $('#releaseCubesVersion').val();
            var result = call("ncubeController.releaseCubes", [getAppId(), newSnapVer]);
            if (result.status === true)
            {
                var saveSelectedVersion = _selectedVersion;
                loadVersions();
                _selectedVersion = doesItemExist(saveSelectedVersion, _versions) ? saveSelectedVersion : _selectedVersion;
                loadVersionListView();
                loadNCubes();
                loadNCubeListView();
                loadCube();
                runSearch();

            }
            else
            {
                showNote("Unable to release version '" + _selectedVersion + "':<hr class=\"hr-small\"/>" + result.data);
            }
        }, PROGRESS_DELAY);
    }

    function changeVersion()
    {
        clearError();
        if (!ensureModifiable('Version cannot be changed.'))
        {
            return;
        }

        $('#changeVerLabel')[0].textContent = 'Change ' + _selectedApp + ' ' + _selectedVersion + ' ?';
        $('#changeVerModal').modal();
    }

    function changeVersionOk()
    {
        setTimeout(function() {
            $('#changeVerModal').modal('hide');
            var newSnapVer = $('#changeVerValue').val();
            var result = call("ncubeController.changeVersionValue", [getAppId(), newSnapVer]);
            if (result.status === true)
            {
                loadVersions();
                _selectedVersion = doesItemExist(newSnapVer, _versions) ? newSnapVer : _selectedVersion;
                loadVersionListView();
                loadNCubes();
                loadNCubeListView();
                loadCube();
                runSearch();
            }
            else
            {
                showNote("Unable to change SNAPSHOT version to value '" + newSnapVer + "':<hr class=\"hr-small\"/>" + result.data);
            }
        }, PROGRESS_DELAY);
    }

    function ensureModifiable(operation)
    {
        clearError();
        if (!_selectedApp || !_selectedVersion || !_selectedCubeName || !_selectedStatus)
        {
            showNote(operation + ' No n-cube selected.');
            return false;
        }
        if (_selectedStatus == "RELEASE")
        {
            showNote(operation + ' Only a SNAPSHOT version can be modified.');
            return false;
        }
        if (isHeadSelected())
        {
            selectBranch();
            return false;
        }

        return true;
    }

    function clearStorage() {
        var keys = Object.keys(localStorage);
        for (var i = 0, len = keys.length; i < len; i++) {
            var key = keys[i];
            if (key.startsWith(NCE_PREFIX)) {
                delete localStorage[key];
            }
        }
    }

    function clearCache()
    {
        var result = call("ncubeController.clearCache", [getAppId()]);

        if (result.status === false)
        {
            showNote('Unable to clear cache:<hr class="hr-small"/>' + result.data);
        }
    }

    function serverStats()
    {
        var result = call("ncubeController.heartBeat", [{}]);

        if (result.status === false)
        {
            showNote('Unable to fetch server statistics:<hr class="hr-small"/>' + result.data);
            return;
        }
        clearError();
        displayMap(result.data.serverStats, 'Server Statistics');
    }

    function httpHeaders()
    {
        var result = call("ncubeController.getHeaders", []);

        if (result.status === false)
        {
            showNote('Unable to fetch HTTP headers:<hr class="hr-small"/>' + result.data);
            return;
        }
        clearError();
        displayMap(result.data, 'HTTP Headers');
    }

    function displayMap(map, title)
    {
        delete map['@type'];
        var msg = '';
        var maxValLen = 0;
        var rows = 0;

        for (var key in map)
        {
            if (map.hasOwnProperty(key))
            {
                rows++;
                var val = '' + map[key];
                if (val.length > 50)
                {   // Hard-coded to size of current (330px) gritter text area (reduced by gritter-image size)
                    val = val.substring(0, 5) + '...' + val.substr(-54);
                }
                msg += '<dt>' + key + '</dt>';
                msg += '<dd>' + val + '</dd>';

                if (val.length > maxValLen)
                {
                    maxValLen = val.length;
                }
            }
        }

        if (maxValLen > 32 || rows == 1)
        {
            msg = '<dl>' + msg;
        }
        else
        {
            msg = '<dl class="dl-horizontal">' + msg;
        }
        msg += '</dl>';

        showNote(msg, title);
    }

    // ======================================== Everything to do with Branching ========================================

    function addBranchListeners()
    {
        // Main menu options
        $('#branchSelect').click(function()
        {
            setTimeout(function() { selectBranch(); }, PROGRESS_DELAY);
            showNote('Getting list of branches...');
        });
        $('#branchCommit').click(function()
        {
            setTimeout(function() { commitBranch(true); }, PROGRESS_DELAY);
            showNote('Processing commit request...');
        });
        $('#commitRollbackSelectAll').click(function()
        {
            checkAll(true, 'input[type="checkbox"]')
        });
        $('#commitRollbackSelectNone').click(function()
        {
            checkAll(false, 'input[type="checkbox"]')
        });
        $('#commitOk').click(function()
        {
            commitOk();
        });
        $('#rollbackOk').click(function()
        {
            rollbackOk();
        });
        $('#branchRollback').click(function()
        {
            setTimeout(function() { commitBranch(false); }, PROGRESS_DELAY);
            showNote('Processing rollback request...');
        });
        $('#branchUpdate').click(function()
        {
            setTimeout(function() { callUpdate(); }, PROGRESS_DELAY);
            showNote('Updating branch...');
        });
        $('#branchDelete').click(function()
        {
            deleteBranch();
        });
        $('#deleteBranchOk').click(function()
        {
            deleteBranchOk();
        });
        // From 'Select / Create Branch' Modal
        $('#createBranch').click(function()
        {
            createBranch();
        });
        $('#branchNameWarning').find('button').click(function()
        {
            $('#branchNameWarning').hide();
        });
        $('#compareCubes').click(function(e)
        {
            diffConflicts();
        });
        $('#acceptTheirs').click(function(e)
        {
            acceptTheirs();
        });
        $('#acceptMine').click(function(e)
        {
            acceptMine();
        });
        $('#mergeClose').click(function(e)
        {
            setTimeout(function() {
                loadNCubes();
                loadNCubeListView();
                reloadCube();
                runSearch();
            }, PROGRESS_DELAY);
            showNote('Closing merge window, reloading cubes...', 'Note', 1000);
        });
    }

    function showActiveBranch()
    {
        $('#BranchMenu')[0].innerHTML = 'Branch:&nbsp;<button class="btn-sm btn-primary">&nbsp;' + (_selectedBranch || head) + '&nbsp;<b class="caret"></b></button>';
    }

    function getBranchNames(refresh) {
        if (refresh || _branchNames.length === 0) {
            var result = call("ncubeController.getBranches", []);
            if (!result.status) {
                showNote('Unable to get branches:<hr class="hr-small"/>' + result.data);
                return [];
            }
            _branchNames = result.data;
        }
        return _branchNames;
    }

    function selectBranch()
    {
        clearError();
        $('#newBranchName').val("");
        $('#branchNameWarning').hide();

        var branchNames = getBranchNames(true);
        var ul = $('#branchList');
        ul.empty();

        $.each(branchNames, function (index, name)
        {
            if (!name)
            {
                name = head;
            }
            var li = $('<li/>').attr({'class': 'list-group-item skinny-lr'});
            var anchor = $('<a href="#"/>');
            anchor[0].innerHTML = '<kbd> ' + name + ' </kbd>';
            anchor.click(function ()
            {
                changeBranch(name);
            });
            li.append(anchor);
            ul.append(li);
        });

        _selectBranchModal.modal('show');
    }

    function createBranch()
    {
        clearError();

        var branchName = $('#newBranchName').val();
        var validName = /^[a-zA-Z_][0-9a-zA-Z_.-]*$/i;

        if (!branchName || !validName.test(branchName) || head.toLowerCase() == branchName.toLowerCase())
        {
            $('#branchNameWarning').show();
            return;
        }

        var appId = getAppId();
        appId.branch = branchName;
        if (!_selectedApp || !_selectedVersion || !_selectedStatus)
        {
            changeBranch(branchName);
            return;
        }

        setTimeout(function() {
            var result = call("ncubeController.createBranch", [appId]);
            if (!result.status)
            {
                clearError();
                showNote('Unable to create branch:<hr class="hr-small"/>' + result.data);
                return;
            }
            changeBranch(branchName);
        }, PROGRESS_DELAY);
        _selectBranchModal.modal('hide');
        showNote('Creating branch: ' + branchName, 'Creating...');
    }

    function changeBranch(branchName)
    {
         if (head.toLowerCase() == branchName.toLowerCase())
         {
             branchName = head;
         }
        _selectedBranch = branchName;
        localStorage[SELECTED_BRANCH] = branchName;
        _selectBranchModal.modal('hide');

        setTimeout(function() {
            showActiveBranch();
            loadAppNames();
            loadVersions();
            loadNCubes();
            loadAppListView();
            loadStatusListView();
            loadVersionListView();
            loadNCubeListView();
            runSearch();
            buildMenu();
            clearError();
        }, PROGRESS_DELAY);
        clearError();
        showNote('Changing branch to: ' + branchName, 'Please wait...');
    }

    function commitBranch(state)
    {
        clearError();

        var errMsg;
        var title;
        if (state)
        {
            errMsg = 'commit to';
            title = 'Commit changes';
            $('#commitOk').show();
            $('#rollbackOk').hide();
        }
        else
        {
            errMsg = 'rollback in';
            title = 'Rollback changes';
            $('#commitOk').hide();
            $('#rollbackOk').show();
        }

        if (isHeadSelected())
        {
            showNote('You cannot ' + errMsg + ' HEAD.');
            return;
        }

        var result = call("ncubeController.getBranchChanges", [getAppId()]);

        if (!result.status || !result.data)
        {
            showNote('Unable to get branch changes:<hr class="hr-small"/>' + result.data);
            return;
        }

        $('#commitRollbackLabel')[0].textContent = title;

        var branchChanges = result.data;
        branchChanges.sort(
            function compare(a,b)
            {
                return a.name.localeCompare(b.name);
            });

        _commitModal.prop('changes', branchChanges);
        var ul = $('#commitRollbackList');
        ul.empty();

        $.each(branchChanges, function (index, infoDto)
        {
            var li = $('<li/>').prop({class: 'list-group-item skinny-lr no-margins'});
            li.css('padding-left', 0);

            var anchorDiff = $('<a href="#"/>');
            anchorDiff.click(function(e)
            {
                var leftInfoDto = $.extend(true, {}, infoDto);
                leftInfoDto.branch = 'HEAD';
                diffCubes(leftInfoDto, infoDto, infoDto.name);
            });
            var kbd = $('<kbd/>');
            kbd[0].textContent = 'Compare';
            anchorDiff.append(kbd);
            var labelB = $('<label/>').prop({class: 'col-xs-1', style:'margin:0;margin-right:20px'});
            labelB.css('padding', 0);
            labelB.css('margin', 0);
            labelB.css('margin-right', '10px');
            labelB.append(anchorDiff);

            var div = $('<div/>').prop({class:'container-fluid'});
            var checkbox = $('<input>').prop({class:'commitCheck', type:'checkbox'});
            var label = $('<label/>').prop({class: 'checkbox no-margins col-xs-10'});
            label[0].textContent = infoDto.name;

            if (infoDto.revision < 0)
            {
                label.addClass('cube-deleted');
            }
            else if (!infoDto.headSha1)
            {
                if (infoDto.sha1)
                {
                    label.addClass('cube-added');
                }
                else
                {
                    if (infoDto.changeType == 'D')
                    {
                        label.addClass('cube-deleted');
                    }
                    else if (infoDto.changeType == 'R')
                    {
                        label.addClass('cube-restored');
                    }
                }
            }
            else
            {
                if (infoDto.headSha1 != infoDto.sha1)
                {
                    label.addClass('cube-modified');
                }
                else if (infoDto.changeType == 'D')
                {
                    label.addClass('cube-deleted');
                }
                else if (infoDto.changeType == 'R')
                {
                    label.addClass('cube-restored');
                }
            }
            checkbox.prependTo(label); // <=== create input without the closing tag
            div.append(labelB);
            div.append(label);
            li.append(div);
            ul.append(li);
        });

        checkAll(true, 'input[type="checkbox"]');
        _commitModal.modal('show');
    }

    function commitOk()
    {
        var branchChanges = _commitModal.prop('changes');
        var input = $('#commitRollbackList').find('.commitCheck');
        var changes = [];

        $.each(input, function (index, label)
        {
            if ($(this).is(':checked'))
            {
                changes.push(branchChanges[index]);
            }
        });

        _commitModal.modal('hide');

        callCommit(changes);
    }

    function callCommit(changedDtos, fromTabMenu) {
        showNote('Committing changes on selected cubes...', 'Please wait...');
        setTimeout(function() {
            var result;
            if (fromTabMenu) {
                var cubeName = changedDtos[0].name;
                result = call("ncubeController.commitCube", [getAppId(), cubeName]);
            } else {
                result = call("ncubeController.commitBranch", [getAppId(), changedDtos]);
            }

            clearError();
            if (result.status === false)
            {
                showNote('You have conflicts with the HEAD branch.  Update Branch first, then re-attempt branch commit.');
                return;
            }

            loadNCubes();
            loadNCubeListView();
            reloadCube();
            runSearch();

            var note = 'Successfully committed ' + result.data.length + ' cube(s).<hr class="hr-small"/>';
            note += '<b style="color:cornflowerblue">Committed cubes:</b><br>';
            $.each(result.data, function(idx, infoDto)
            {
                note += infoDto.name + '<br>';
            });
            showNote(note);
        }, PROGRESS_DELAY);
    }

    function rollbackOk()
    {
        var branchChanges = _commitModal.prop('changes');
        var input = $('#commitRollbackList').find('.commitCheck');
        var changes = [];
        $.each(input, function (index, label)
        {
            if ($(this).is(':checked'))
            {
                changes.push(branchChanges[index]);
            }
        });

        _commitModal.modal('hide');
        callRollback(changes);
    }

    function callRollback(changes) {
        showNote('Rolling back changes on selected cubes...', 'Please wait...');
        setTimeout(function(){
            var names = [];
            for (var i=0; i < changes.length; i++)
            {
                names.push(changes[i].name)
            }
            var result = call("ncubeController.rollbackBranch", [getAppId(), names]);
            clearError();

            if (result.status === false)
            {
                showNote('Unable to rollback cubes:<hr class="hr-small"/>' + result.data);
                return;
            }

            loadNCubes();
            loadNCubeListView();
            reloadCube();
            runSearch();

            var note = 'Successfully rolled back ' + changes.length + ' cube(s).<hr class="hr-small"/>';
            note += '<b style="color:cornflowerblue">Rolled back cubes:</b><br>';
            $.each(changes, function(idx, infoDto)
            {
                note += infoDto.name + '<br>';
            });
            showNote(note);
        }, PROGRESS_DELAY);
    }

    function callUpdate(sourceBranch)
    {
        clearError();

        var result;
        if (sourceBranch != undefined) {
            result = call('ncubeController.updateBranchCube', [getAppId(), _selectedCubeName, sourceBranch]);
        } else  {
            result = call('ncubeController.updateBranch', [getAppId()]);
        }
        if (!result.status)
        {
            showNote('Unable to update branch:<hr class="hr-small"/>' + result.data);
            return;
        }

        var map = result.data;
        var updateMap = map['updates'];
        var mergeMap = map['merges'];
        var conflictMap = map['conflicts'];
        var updates = 0;
        var merges = 0;
        var conflicts = 0;

        if (updateMap && updateMap['@items'])
        {
            updates = updateMap['@items'].length;
        }
        if (mergeMap && mergeMap['@items'])
        {
            merges = mergeMap['@items'].length;
        }
        if (conflictMap)
        {
            delete conflictMap['@type'];
            conflicts = countKeys(conflictMap);
        }

        var note = '<b>Branch Updated:</b><hr class="hr-small"/>' + updates + ' cubes <b>updated</b><br>' + merges + ' cubes <b>merged</b><br>' + conflicts + ' cubes in <b>conflict</b>';
        var i;
        if (updates > 0)
        {
            var upMap = updateMap['@items'];
            note += '<hr class="hr-small"/><b style="color:cornflowerblue">Updated cube names:</b><br>';
            upMap.sort(function(a, b)
            {   // sort case-insensitively, use client-side CPU
                var lowA = a.name.toLowerCase();
                var lowB = b.name.toLowerCase();
                return lowA.localeCompare(lowB);
            });
            for (i = 0; i < updates; i++)
            {
                note += upMap[i].name + '<br>';
            }
        }
        if (merges > 0)
        {
            var mMap = mergeMap['@items'];
            note += '<hr class="hr-small"/><b style="color:#D4AF37">Merged cube names:</b><br>';
            mMap.sort(function(a, b)
            {   // sort case-insensitively, use client-side CPU
                var lowA = a.name.toLowerCase();
                var lowB = b.name.toLowerCase();
                return lowA.localeCompare(lowB);
            });
            for (i=0; i < merges; i++)
            {
                note += mMap[i].name + '<br>';
            }
        }
        if (conflicts > 0)
        {
            note += '<hr class="hr-small"/><b style="color:#F08080">Cubes in conflict:</b><br>';
            var names = Object.keys(conflictMap);
            names.sort(function(a, b)
            {   // sort case-insensitively, use client-side CPU
                var lowA = a.toLowerCase();
                var lowB = b.toLowerCase();
                return lowA.localeCompare(lowB);
            });
            $.each(names, function(index, value)
            {
                note += value + '<br>';
            });
        }
        showNote(note);

        if (conflicts > 0)
        {
            mergeBranch(conflictMap);
            return;
        }

        loadNCubes();
        loadNCubeListView();
        reloadCube();
        runSearch();
    }

    function deleteBranch()
    {
        if (isHeadSelected())
        {
            showNote('HEAD branch cannot be deleted.');
            return;
        }

        $('#deleteBranchLabel')[0].textContent = "Delete '" + _selectedBranch + "' ?";
        $('#deleteBranchModal').modal();
    }

    function deleteBranchOk()
    {
        $('#deleteBranchModal').modal('hide');
        clearError();

        var result = call('ncubeController.deleteBranch', [getAppId()]);
        changeBranch(head);
        if (!result.status)
        {
            showNote('Unable to delete branch:<hr class="hr-small"/>' + result.data);
        }
    }

    function mergeBranch(conflictMap)
    {
        delete conflictMap['@type'];
        var ul = $('#mergeList');
        ul.empty();

        // Sort keys of Map
        var keys = Object.keys(conflictMap);
        keys.sort(function(a, b)
        {
            var lowA = a.toLowerCase();
            var lowB = b.toLowerCase();
            return lowA.localeCompare(lowB);
        });

        // Walk sorted keys, indexing into Map
        $.each(keys, function(index, cubeName)
        {
            var li = $('<li style="border:none"/>').prop({class: 'list-group-item skinny-lr'});
            var div = $('<div/>').prop({class:'container-fluid'});
            var checkbox = $('<input>').prop({type:'radio'});
            checkbox.click(function ()
            {
                markMutuallyExclusive(checkbox);
                _mergeCubeName = cubeName;
                _mergeSha1 = conflictMap[cubeName].sha1;
                _mergeHeadSha1 = conflictMap[cubeName].headSha1;
            });
            var label = $('<label/>').prop({class: 'radio no-margins'});
            label[0].textContent = cubeName;
            checkbox.prependTo(label); // <=== create input without the closing tag
            div.append(label);
            li.append(div);
            ul.append(li);
        });
        $('#mergeBranchModal').modal('show');
    }

    function markMutuallyExclusive(checkbox)
    {
        var inputs = $('#mergeList').find('input');
        $.each(inputs, function (key, value)
        {
            $(value).prop('checked', false);
        });
        checkbox.prop('checked', true );
    }

    function getSelectedConflict()
    {
        var checkedInput = $('#mergeList').find('input:checked');
        if (checkedInput.length == 0)
        {
            showNote('Select a cube', 'Note', 3000);
            return null;
        }
        return checkedInput.parent()[0].textContent;
    }

    function diffConflicts()
    {
        var conflictedCube = getSelectedConflict();
        if (!conflictedCube)
        {
            return;
        }
        var appId = getAppId();
        var infoDto = {
            name: conflictedCube,
            app: appId.app,
            version: appId.version,
            status: appId.status,
            branch: appId.branch
        };
        var leftInfoDto = $.extend(true, {}, infoDto);
        leftInfoDto.branch = 'HEAD';
        diffCubes(leftInfoDto, infoDto, conflictedCube);
    }

    function acceptTheirs()
    {
        var conflictedCube = getSelectedConflict();
        if (!conflictedCube)
        {
            return;
        }

        var result = call('ncubeController.acceptTheirs', [getAppId(), _mergeCubeName, _mergeSha1]);
        if (result.status === true)
        {
            showNote('Cube: ' + _mergeCubeName + ' updated in your branch with cube from HEAD', 'Note', 5000);
            $('#mergeList').find('input:checked').parent().parent().parent().remove();
        }
        else
        {
            showNote('Unable to update your branch cube: ' + _mergeCubeName + ' with cube from HEAD:<hr class="hr-small"/>' + result.data);
        }
        _mergeCubeName = null;
        _mergeSha1 = null;
        _mergeHeadSha1 = null;
    }

    function acceptMine()
    {
        var conflictedCube = getSelectedConflict();
        if (!conflictedCube)
        {
            return;
        }

        var result = call('ncubeController.acceptMine', [getAppId(), _mergeCubeName, _mergeHeadSha1]);
        if (result.status === true)
        {
            showNote('Cube: ' + _mergeCubeName + ' updated to overwrite-on-commit.', 'Note', 5000);
            $('#mergeList').find('input:checked').parent().parent().parent().remove();
        }
        else
        {
            showNote('Unable to update your branch cube: ' + _mergeCubeName + ' to overwrite-on-commit:<hr class="hr-small"/>' + result.data);
        }
        _mergeCubeName = null;
        _mergeSha1 = null;
        _mergeHeadSha1 = null;
    }

    // =============================================== End Branching ===================================================

    // ============================================== Cube Comparison ==================================================
    function diffCubes(leftInfo, rightInfo, title)
    {
        clearError();

        var result = call('ncubeController.fetchBranchDiffs', [leftInfo, rightInfo], {noResolveRefs:true});
        if (result.status !== true)
        {
            showNote('Unable to fetch comparison of cube:<hr class="hr-small"/>' + result.data);
            return;
        }

        setupDiff(result.data, leftInfo.branch, rightInfo.branch, title);
    }

    function diffCubeRevs(id1, id2, leftName, rightName, title)
    {
        clearError();

        var result = call('ncubeController.fetchRevDiffs', [id1, id2], {noResolveRefs:true});
        if (result.status !== true)
        {
            showNote('Unable to fetch comparison of cube:<hr class="hr-small"/>' + result.data);
            return;
        }

        setupDiff(result.data, leftName, rightName, title);
    }

    function setupDiff(diffResult, leftName, rightName, title)
    {
        var titleElem = $('#diffTitle');

        titleElem[0].innerHTML = title;
        _diffLastResult = diffResult;
        _diffLeftName = leftName;
        _diffRightName = rightName;
        diffLoad(DIFF_DESCRIPTIVE);

        // Display Diff Modal
        _diffModal.css('display', 'block');
    }

    function diffLoad(viewType)
    {
        _diffOutput.empty();
        var leftJson = _diffLastResult.left['@items'];
        var rightJson = _diffLastResult.right['@items'];

        if (viewType == DIFF_INLINE || viewType == DIFF_SIDE_BY_SIDE)
        {
            // create a SequenceMatcher instance that diffs the two sets of lines
            var sm = new difflib.SequenceMatcher(leftJson, rightJson);

            // get the opcodes from the SequenceMatcher instance
            // opcodes is a list of 3-tuples describing what changes should be made to the base text
            // in order to yield the new text
            var opcodes = sm.get_opcodes();

            // build the diff view and add it to the current DOM
            _diffOutput[0].appendChild(diffview.buildView({
                baseTextLines: leftJson,
                newTextLines: rightJson,
                opcodes: opcodes,
                // set the display titles for each resource
                baseTextName: _diffLeftName,
                newTextName: _diffRightName,
                contextSize: 3,
                viewType: viewType
            }));
            _diffOutput.find('.author').remove();
        }
        else if (viewType == DIFF_DESCRIPTIVE)
        {
            var textArea = $('<textarea style="width:100%;height:100%;box-sizing:border-box" ondblclick="this.focus();this.select()" readonly/>');
            textArea[0].innerHTML = _diffLastResult.delta;
            _diffOutput.append(textArea);
        }
        else if (viewType == DIFF_VISUAL)
        {
            var div = $('<div style="width:100%;height:100%;box-sizing:border-box;" />');
            var divLeft = $('<div class="innerL"/>');
            var divRight = $('<div class="innerR"/>');
            divLeft[0].innerHTML = _diffLastResult.leftHtml;
            divRight[0].innerHTML = _diffLastResult.rightHtml;
            div.append(divLeft);
            div.append(divRight);
            _diffOutput.append(div);
        }
        else
        {
            console.log('Error -> Unknown DIFF type');
        }
    }

    // ============================================ End Cube Comparison ================================================

    // ============================================= General Utilities =================================================
    function loop()
    {
        setInterval(function()
        {
            var now = Date.now();
            if (now - _searchLastKeyTime > 150 && _searchKeyPressed)
            {
                _searchKeyPressed = false;
                runSearch();
            }
        }, 500);
    }

    function createHeartBeatTransferObj() {
        var obj = {};
        for (var i = 0, len = _openCubes.length; i < len; i++) {
            var cubeInfo = _openCubes[i].cubeKey.split(TAB_SEPARATOR);
            var key = cubeInfo.slice(0, CUBE_INFO.TAB_VIEW).join(TAB_SEPARATOR);
            obj[key] = '';
        }

        return {obj:obj, aBuffer: new ArrayBuffer(1024 * 1024)};
    }

    function heartBeat() {
        var transferObj = createHeartBeatTransferObj();
        _heartBeatThread.postMessage(transferObj, [transferObj.aBuffer]);
        setInterval(function() {
            transferObj = createHeartBeatTransferObj();
            _heartBeatThread.postMessage(transferObj, [transferObj.aBuffer]);
        }, 60000);
    }

    function doesItemExist(item, list)
    {
        if (!item)
        {
            return false;
        }
        var found = false;
        $.each(list, function (index, value)
        {
            if (item.toLowerCase() === value.toLowerCase())
            {
                found = true;
                return;
            }
        });
        return found;
    }

    function showNote(msg, title, millis)
    {
        _errorId = $.gritter.add({
            title: (title || 'Note'),
            text: msg,
            image: './img/cube-logo.png',
            sticky: !millis,
            append: false,
            time: (millis || 0)
        });
    }

    function clearError()
    {
        if (_errorId)
        {
            $.gritter.remove(_errorId);
            _errorId = null;
        }
    }

    function isHeadSelected()
    {
        return head == _selectedBranch;
    }
    /**
     * Get the ApplicationID based on the user's selections.  Tenant is sent not sent (server will fill
     * that in based on authentication.
     * @returns {app: *, version: *, status: string, branch: *}
     */
    function getAppId()
    {
        return {
            'app':_selectedApp,
            'version':_selectedVersion,
            'status':_selectedStatus,
            'branch':_selectedBranch
        }
    }

    function getSelectedCubeName()
    {
        return _selectedCubeName;
    }

    function getSelectedApp()
    {
        return _selectedApp;
    }

    function getSelectedVersion()
    {
        return _selectedVersion;
    }

    var getSelectedStatus = function()
    {
        return _selectedStatus;
    };

    var setActiveTabViewType = function(viewType)
    {
        _activeTabViewType = viewType;
        return getActiveTabViewType();
    };

    var getActiveTabViewType = function()
    {
        if (!_activeTabViewType)
        {
            _activeTabViewType = 'n-cube' + PAGE_ID;
        }
        return _activeTabViewType;
    };

    // API
    return {
        getSelectedStatus: getSelectedStatus,
        buildTabs: buildTabs
    }

})(jQuery);

function frameLoaded()
{
    NCE.buildTabs();
    $('.fadeMe2').fadeOut(800, function()
    {
        $('.fadeMe2').remove();
    });
    $('#fadeMe1').fadeOut(500, function()
    {
        $('#fadeMe1').remove();
    });
}