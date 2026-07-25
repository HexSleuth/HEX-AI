(function () {
  'use strict';

  function install(win) {
    'use strict';

    if (!win || !win.document) return;
    var doc = win.document;
    var KEY = '__backgroundMediaPlaybackKeepalive';

    if (win[KEY] && win[KEY].installed) return;

    var eventTargetProto = win.EventTarget && win.EventTarget.prototype;
    var mediaProto = win.HTMLMediaElement && win.HTMLMediaElement.prototype;
    if (!eventTargetProto) return;

    var state = win[KEY] || {};
    state.installed = true;
    state.version = '0.2.2';
    state.disabled = false;
    state.lastPlayAt = 0;
    state.lastActiveMediaAt = 0;
    state.lastBackgroundEventAt = 0;
    state.lastBackgroundEvent = '';
    state.lastUserInteractionAt = 0;
    state.lastUserInteraction = '';
    state.wrappedListeners = state.wrappedListeners || 0;
    state.blockedEvents = state.blockedEvents || 0;
    state.observedEvents = state.observedEvents || 0;
    state.blockedPauses = state.blockedPauses || 0;
    state.allowedUserPauses = state.allowedUserPauses || 0;
    state.debug = state.debug || [];
    win[KEY] = state;

    var knownMedia = new Set();
    var BACKGROUND_EVENT_PAUSE_WINDOW_MS = 3000;
    var RECENT_PLAY_WINDOW_MS = 8000;
    var USER_INTERACTION_PAUSE_WINDOW_MS = 1500;
    var DEBUG_LIMIT = 80;
    var nativeDocProps = {};

    var backgroundEvents = {
      blur: true,
      visibilitychange: true,
      webkitvisibilitychange: true,
      mozvisibilitychange: true,
      msvisibilitychange: true,
      pagehide: true,
      freeze: true
    };

    function now() {
      return Date.now();
    }

    function debug(type, data) {
      try {
        state.debug.push(Object.assign({ type: type, at: now(), url: String(location.href) }, data || {}));
        if (state.debug.length > DEBUG_LIMIT) state.debug.shift();
      } catch (_) {}
    }

    function findDescriptor(target, prop) {
      try {
        var current = target;
        while (current) {
          var descriptor = Object.getOwnPropertyDescriptor(current, prop);
          if (descriptor) return descriptor;
          current = Object.getPrototypeOf(current);
        }
      } catch (_) {}
      return null;
    }

    function captureNativeDocProp(prop, fallback) {
      var descriptor = findDescriptor(doc, prop);
      nativeDocProps[prop] = function () {
        try {
          if (descriptor) {
            if (descriptor.get) return descriptor.get.call(doc);
            if ('value' in descriptor) return descriptor.value;
          }
        } catch (_) {}
        return fallback;
      };
    }

    captureNativeDocProp('hidden', false);
    captureNativeDocProp('webkitHidden', false);
    captureNativeDocProp('mozHidden', false);
    captureNativeDocProp('msHidden', false);
    captureNativeDocProp('visibilityState', 'visible');
    captureNativeDocProp('webkitVisibilityState', 'visible');
    captureNativeDocProp('mozVisibilityState', 'visible');
    captureNativeDocProp('msVisibilityState', 'visible');

    var nativeHasFocus = typeof doc.hasFocus === 'function' ? doc.hasFocus.bind(doc) : function () {
      return true;
    };

    function defineGetter(target, prop, value) {
      if (!target) return;
      try {
        Object.defineProperty(target, prop, {
          configurable: true,
          get: function () {
            return typeof value === 'function' ? value() : value;
          }
        });
      } catch (_) {}
    }

    function defineValue(target, prop, value) {
      if (!target) return;
      try {
        Object.defineProperty(target, prop, {
          configurable: true,
          writable: true,
          value: value
        });
      } catch (_) {
        try {
          target[prop] = value;
        } catch (_) {}
      }
    }

    function nativeValue(prop, fallback) {
      try {
        return nativeDocProps[prop] ? nativeDocProps[prop]() : fallback;
      } catch (_) {
        return fallback;
      }
    }

    function shouldSpoofVisible() {
      if (state.disabled) return false;
      return !!findActiveMedia() ||
        now() - state.lastPlayAt < RECENT_PLAY_WINDOW_MS ||
        now() - state.lastBackgroundEventAt < BACKGROUND_EVENT_PAUSE_WINDOW_MS;
    }

    function forceVisible(target) {
      defineGetter(target, 'hidden', function () {
        return shouldSpoofVisible() ? false : nativeValue('hidden', false);
      });
      defineGetter(target, 'webkitHidden', function () {
        return shouldSpoofVisible() ? false : nativeValue('webkitHidden', false);
      });
      defineGetter(target, 'mozHidden', function () {
        return shouldSpoofVisible() ? false : nativeValue('mozHidden', false);
      });
      defineGetter(target, 'msHidden', function () {
        return shouldSpoofVisible() ? false : nativeValue('msHidden', false);
      });
      defineGetter(target, 'visibilityState', function () {
        return shouldSpoofVisible() ? 'visible' : nativeValue('visibilityState', 'visible');
      });
      defineGetter(target, 'webkitVisibilityState', function () {
        return shouldSpoofVisible() ? 'visible' : nativeValue('webkitVisibilityState', 'visible');
      });
      defineGetter(target, 'mozVisibilityState', function () {
        return shouldSpoofVisible() ? 'visible' : nativeValue('mozVisibilityState', 'visible');
      });
      defineGetter(target, 'msVisibilityState', function () {
        return shouldSpoofVisible() ? 'visible' : nativeValue('msVisibilityState', 'visible');
      });
      defineValue(target, 'hasFocus', function () {
        return shouldSpoofVisible() ? true : nativeHasFocus();
      });
    }

    forceVisible(doc);
    forceVisible(win.Document && win.Document.prototype);
    forceVisible(win.HTMLDocument && win.HTMLDocument.prototype);

    function mediaIsActive(media) {
      try {
        return !!media && !media.paused && !media.ended && media.readyState >= 1;
      } catch (_) {
        return false;
      }
    }

    function findActiveMedia() {
      try {
        for (var item of knownMedia) {
          if (mediaIsActive(item)) return item;
        }
      } catch (_) {}

      try {
        var media = doc.querySelectorAll('video,audio');
        for (var i = 0; i < media.length; i += 1) {
          knownMedia.add(media[i]);
          if (mediaIsActive(media[i])) return media[i];
        }
      } catch (_) {}

      return null;
    }

    function shouldProtectFromBackgroundEvent() {
      if (state.disabled) return false;
      if (findActiveMedia()) {
        state.lastActiveMediaAt = now();
        return true;
      }
      return now() - state.lastPlayAt < RECENT_PLAY_WINDOW_MS;
    }

    function rememberBackgroundEvent(eventName) {
      state.lastBackgroundEventAt = now();
      state.lastBackgroundEvent = eventName;
    }

    function shouldBlockPauseCall(media) {
      if (state.disabled) return false;
      if (!mediaIsActive(media)) return false;
      return now() - state.lastBackgroundEventAt < BACKGROUND_EVENT_PAUSE_WINDOW_MS;
    }

    function wasRecentUserInteraction() {
      return now() - state.lastUserInteractionAt < USER_INTERACTION_PAUSE_WINDOW_MS;
    }

    if (mediaProto && mediaProto.play && !mediaProto.play[KEY]) {
      var rawPlay = mediaProto.play;
      var patchedPlay = function () {
        knownMedia.add(this);
        state.lastPlayAt = now();
        var result = rawPlay.apply(this, arguments);
        try {
          if (result && typeof result.then === 'function') {
            result.then(function () {
              state.lastPlayAt = now();
            }, function () {});
          }
        } catch (_) {}
        return result;
      };
      defineValue(patchedPlay, KEY, true);
      defineValue(mediaProto, 'play', patchedPlay);
    }

    if (mediaProto && mediaProto.pause && !mediaProto.pause[KEY]) {
      var rawPause = mediaProto.pause;
      var patchedPause = function () {
        knownMedia.add(this);
        if (shouldBlockPauseCall(this)) {
          if (wasRecentUserInteraction()) {
            state.allowedUserPauses += 1;
            debug('allowed-user-pause', {
              event: state.lastBackgroundEvent,
              interaction: state.lastUserInteraction
            });
            return rawPause.apply(this, arguments);
          }
          state.blockedPauses += 1;
          debug('blocked-pause', { event: state.lastBackgroundEvent });
          return undefined;
        }
        return rawPause.apply(this, arguments);
      };
      defineValue(patchedPause, KEY, true);
      defineValue(mediaProto, 'pause', patchedPause);
    }

    var rawAddEventListener = eventTargetProto.addEventListener;

    function captureUserInteraction(event) {
      if (!event || event.isTrusted !== true) return;

      var eventName = String(event.type || '').toLowerCase();
      if (eventName === 'keydown') {
        var key = String(event.key || '').toLowerCase();
        var isPauseKey = key === ' ' ||
          key === 'spacebar' ||
          key === 'enter' ||
          key === 'k' ||
          key === 'mediaplaypause' ||
          key === 'mediapause';
        if (!isPauseKey || event.ctrlKey || event.altKey || event.metaKey) return;
        eventName += ':' + key;
      }

      state.lastUserInteractionAt = now();
      state.lastUserInteraction = eventName;
    }

    function captureShield(event) {
      var eventName = String(event && event.type || '').toLowerCase();
      if (!backgroundEvents[eventName]) return;
      if (!shouldProtectFromBackgroundEvent()) return;

      rememberBackgroundEvent(eventName);
      state.observedEvents += 1;
      debug('observed-event', {
        event: eventName,
        target: event.currentTarget === win ? 'window' : 'document'
      });
    }

    try {
      rawAddEventListener.call(doc, 'pointerdown', captureUserInteraction, true);
      rawAddEventListener.call(doc, 'pointerup', captureUserInteraction, true);
      rawAddEventListener.call(doc, 'mousedown', captureUserInteraction, true);
      rawAddEventListener.call(doc, 'mouseup', captureUserInteraction, true);
      rawAddEventListener.call(doc, 'touchstart', captureUserInteraction, true);
      rawAddEventListener.call(doc, 'touchend', captureUserInteraction, true);
      rawAddEventListener.call(doc, 'click', captureUserInteraction, true);
      rawAddEventListener.call(doc, 'keydown', captureUserInteraction, true);
      rawAddEventListener.call(win, 'blur', captureShield, true);
      rawAddEventListener.call(win, 'pagehide', captureShield, true);
      rawAddEventListener.call(win, 'freeze', captureShield, true);
      rawAddEventListener.call(doc, 'visibilitychange', captureShield, true);
      rawAddEventListener.call(doc, 'webkitvisibilitychange', captureShield, true);
      rawAddEventListener.call(doc, 'mozvisibilitychange', captureShield, true);
      rawAddEventListener.call(doc, 'msvisibilitychange', captureShield, true);
    } catch (_) {}

    debug('installed', {});
  }

  try {
    install(typeof unsafeWindow === 'undefined' ? window : unsafeWindow);
  } catch (_) {
    try {
      install(window);
    } catch (_) {}
  }
})();