/**
 * This is an extension to the locationProvider of angular:
 * It allows normal urls to be used in $location, without hashbang or html5 mode.
 * This is required for the hashchange handling of jquery mobile to work properly.
 * Furthermore, this extends the $browser so that it reuses the hashchange handler of
 * jqm for angular and ensures, that angular's handler is always called before the one from jqm.
 * By this, $location is always up to date when jquery mobile fires pagebeforecreate, ...
 * <p>
 * Configuration: $locationProvider.plainMode(true) enables this new mode.
 * <p>
 * Note: Much of the code below is copied from angular, as it is contained in an internal angular function scope.
 */
(function (angular, $) {
    var URL_MATCH = /^([^:]+):\/\/(\w+:{0,1}\w*@)?([\w\.-]*)(:([0-9]+))?(\/[^\?#]*)?(\?([^#]*))?(#(.*))?$/,
        PATH_MATCH = /^([^\?#]*)?(\?([^#]*))?(#(.*))?$/,
        DEFAULT_PORTS = {'http':80, 'https':443, 'ftp':21};


    /**
     * Parses an escaped url query string into key-value pairs.
     * @returns Object.<(string|boolean)>
     */
    function parseKeyValue(/**string*/keyValue) {
        var obj = {}, key_value, key;
        angular.forEach((keyValue || "").split('&'), function (keyValue) {
            if (keyValue) {
                key_value = keyValue.split('=');
                key = decodeURIComponent(key_value[0]);
                obj[key] = angular.isDefined(key_value[1]) ? decodeURIComponent(key_value[1]) : true;
            }
        });
        return obj;
    }

    /**
     * This method is intended for encoding *key* or *value* parts of query component. We need a custom
     * method becuase encodeURIComponent is too agressive and encodes stuff that doesn't have to be
     * encoded per http://tools.ietf.org/html/rfc3986:
     *    query       = *( pchar / "/" / "?" )
     *    pchar         = unreserved / pct-encoded / sub-delims / ":" / "@"
     *    unreserved    = ALPHA / DIGIT / "-" / "." / "_" / "~"
     *    pct-encoded   = "%" HEXDIG HEXDIG
     *    sub-delims    = "!" / "$" / "&" / "'" / "(" / ")"
     *                     / "*" / "+" / "," / ";" / "="
     */
    function encodeUriQuery(val, pctEncodeSpaces) {
        return encodeURIComponent(val).
            replace(/%40/gi, '@').
            replace(/%3A/gi, ':').
            replace(/%24/g, '$').
            replace(/%2C/gi, ',').
            replace((pctEncodeSpaces ? null : /%20/g), '+');
    }

    /**
     * Encode path using encodeUriSegment, ignoring forward slashes
     *
     * @param {string} path Path to encode
     * @returns {string}
     */
    function encodePath(path) {
        var segments = path.split('/'),
            i = segments.length;

        while (i--) {
            segments[i] = encodeUriSegment(segments[i]);
        }

        return segments.join('/');
    }

    /**
     * We need our custom mehtod because encodeURIComponent is too agressive and doesn't follow
     * http://www.ietf.org/rfc/rfc3986.txt with regards to the character set (pchar) allowed in path
     * segments:
     *    segment       = *pchar
     *    pchar         = unreserved / pct-encoded / sub-delims / ":" / "@"
     *    pct-encoded   = "%" HEXDIG HEXDIG
     *    unreserved    = ALPHA / DIGIT / "-" / "." / "_" / "~"
     *    sub-delims    = "!" / "$" / "&" / "'" / "(" / ")"
     *                     / "*" / "+" / "," / ";" / "="
     */
    function encodeUriSegment(val) {
        return encodeUriQuery(val, true).
            replace(/%26/gi, '&').
            replace(/%3D/gi, '=').
            replace(/%2B/gi, '+');
    }

    function toKeyValue(obj) {
        var parts = [];
        angular.forEach(obj, function (value, key) {
            parts.push(encodeUriQuery(key, true) + (value === true ? '' : '=' + encodeUriQuery(value, true)));
        });
        return parts.length ? parts.join('&') : '';
    }

    function int(str) {
        return parseInt(str, 10);
    }

    function matchUrl(url, obj) {
        var match = URL_MATCH.exec(url);

        match = {
            protocol:match[1],
            host:match[3],
            port:int(match[5]) || DEFAULT_PORTS[match[1]] || null,
            path:match[6] || '/',
            search:match[8],
            hash:match[10]
        };

        if (obj) {
            obj.$$protocol = match.protocol;
            obj.$$host = match.host;
            obj.$$port = match.port;
        }

        return match;
    }


    function composeProtocolHostPort(protocol, host, port) {
        return protocol + '://' + host + (port == DEFAULT_PORTS[protocol] ? '' : ':' + port);
    }


    /**
     * Patches the angular LocationHashbangUrl service to use the url directly.
     */
    function patchLocationServiceToUsePlainUrls($location, initUrl) {

        /**
         * Parse given html5 (regular) url string into properties
         * @param {string} newAbsoluteUrl HTML5 url
         * @private
         */
        $location.$$parse = function (newAbsoluteUrl) {
            var match = matchUrl(newAbsoluteUrl, this);

            this.$$path = decodeURIComponent(match.path);
            this.$$search = parseKeyValue(match.search);
            this.$$hash = match.hash && decodeURIComponent(match.hash) || '';

            this.$$compose();
        };

        /**
         * Compose url and update `absUrl` property
         * @private
         */
        $location.$$compose = function () {
            var search = toKeyValue(this.$$search),
                hash = this.$$hash ? '#' + encodePath(this.$$hash) : '';

            this.$$url = encodePath(this.$$path) + (search ? '?' + search : '') + hash;
            this.$$absUrl = composeProtocolHostPort(this.$$protocol, this.$$host, this.$$port) +
                this.$$url;
        };

        $location.$$rewriteAppUrl = function (absoluteLinkUrl) {
            // deactivate link rewriting
            return null;
        };

        $location.$$parse(initUrl);
    }

    /**
     * This reuses the hashchange handler of jqm for angular and ensures, that angular's handler
     * is always called before the one from jqm.
     * By this, $location is always up to date when jquery mobile fires pagebeforecreate, ...
     * @param $browser
     */
    function reusejQueryMobileHashChangeForAngular($browser) {
        if ($browser.isMock) {
            return;
        }
        var urlChangeInit = false;

        var _onUrlChange = $browser.onUrlChange;
        var triggerAngularHashChange;
        $browser.onUrlChange = function (callback) {
            var res;
            if (!urlChangeInit) {
                var _bind = $.fn.bind;
                $.fn.bind = function(event, handler) {
                    triggerAngularHashChange = handler;
                };
                var res = _onUrlChange(callback);
                $.fn.bind = _bind;

                var _hashChange = $.mobile._handleHashChange;
                $.mobile._handleHashChange = function(hash) {
                    triggerAngularHashChange();
                    _hashChange(hash);
                };
                urlChangeInit = true;
            } else {
                res = _onUrlChange(callback);
            }
            return res;
        };

    }

    var ng = angular.module("ng");
    ng.config(['$locationProvider', function ($locationProvider) {
        var plainMode = true;
        /**
         * @ngdoc property
         * @name ng.$locationProvider#plainMode
         * @methodOf ng.$locationProvider
         * @description
         * @param {string=} mode Use plain strategy.
         * @returns {*} current value if used as getter or itself (chaining) if used as setter
         */
        $locationProvider.plainMode = function (mode) {
            if (angular.isDefined(mode)) {
                plainMode = mode;
                return this;
            } else {
                return plainMode;
            }
        };

        var _$get = $locationProvider.$get;
        $locationProvider.$get = ['$injector', '$sniffer', '$browser', function ($injector, $sniffer, $browser) {
            if (plainMode) {
                // Angular should not use the history api and use the hash bang location service,
                // which we will extend below.
                $sniffer.history = false;

                reusejQueryMobileHashChangeForAngular($browser);

                var $location = $injector.invoke(_$get, $locationProvider);
                patchLocationServiceToUsePlainUrls($location, $browser.url());

                return $location;
            } else {
                return $injector.invoke(_$get, $locationProvider);
            }
        }];

    }]);

})(window.angular, window.jQuery);