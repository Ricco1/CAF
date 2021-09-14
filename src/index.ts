import { CastReceiverContext, PlayerManager, PlaybackConfig, NetworkRequestInfo } from 'chromecast-caf-receiver/cast.framework';
import { LoadRequestData } from 'chromecast-caf-receiver/cast.framework.messages';
import { CAFv3Adapter } from 'bitmovin-analytics';

const CAST_MESSAGE_NAMESPACE = 'urn:x-cast:com.formula1.player.caf';

export default class CAFReceiver {
  private readonly player: PlayerManager;
  private readonly context: CastReceiverContext;
  private readonly playbackConfig: PlaybackConfig;
  private currentAudioTrackSelected: null;

  constructor() {
    this.context = cast.framework.CastReceiverContext.getInstance();
    this.player = this.context.getPlayerManager();
    this.playbackConfig = new cast.framework.PlaybackConfig();
    this.currentAudioTrackSelected = null;
  }


  public init() {
    this.playbackConfig.autoResumeDuration = 12;
    this.context.setLoggerLevel(cast.framework.LoggerLevel.DEBUG);
    this.attachEvents();
    this.context.start({playbackConfig: this.playbackConfig});
    this.context.setInactivityTimeout(Number.MAX_VALUE)
  }

  private attachEvents() {
    this.player.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, this.onLoad);
    this.player.addEventListener(cast.framework.events.EventType.ERROR, this.onError);
    this.player.addEventListener(cast.framework.events.EventType.STALLED, this.onStalled);
    this.player.addEventListener(cast.framework.events.EventType.SEEKED, this.onSeeked);
    this.player.addEventListener(cast.framework.events.EventType.PLAYER_LOAD_COMPLETE, this.onPlayerLoadComplete);
    this.context.addCustomMessageListener(CAST_MESSAGE_NAMESPACE, this.onCustomMessage);
  }

  private readonly onError = (e) => {
    console.log('err', e);
  }

  private readonly onSeeked = (e) => {
    // console.log('onSeeked', e);
  }

  private readonly onStalled = (e) => {
    // console.log('onStalled', e);
  }

  private readonly onPlayerLoadComplete = (e) => {
    const clientSelectedLangTrack = this.currentAudioTrackSelected;
    const audioTracksManager = this.player.getAudioTracksManager();
    // Get all audio tracks
    const tracks = audioTracksManager.getTracks();
    const activeTrack = audioTracksManager.getActiveTrack();

    if (clientSelectedLangTrack && activeTrack.name !== clientSelectedLangTrack) {
      for ( let i = 0; i < tracks.length; i++ ) {
        if (clientSelectedLangTrack === tracks[i].name) {
          audioTracksManager.setActiveById(tracks[i].trackId);
          break;
        }
      }
    }
  }

  private readonly checkIfHLS = (reqData, newUrl = '') => {
    if (newUrl.length) {
      if (reqData.media.contentId) {
        reqData.media.contentId = newUrl;
      } else {
        reqData.media.contentUrl = newUrl;
      }
      console.log('reqData', reqData);
    }

    const { media } = reqData;
    const { contentId, contentUrl } = media || {};
    const url = contentId || contentUrl;

    if(!url?.includes('/f1vodprod/')
      && !url?.includes('/hls/')
      && !url?.includes('/dash/')
      && !url?.includes('/out/v1/')
    ) {
      reqData.media.hlsSegmentFormat = cast.framework.messages.HlsSegmentFormat.TS;
    }
    return reqData
  }

  // Setup DRM if present in `media.customData`
  private readonly onLoad = (loadRequestData: LoadRequestData): any => {
    console.log('LOAD Request', loadRequestData);
    console.log('loadRequestData.media.customData', loadRequestData.media.customData);
    console.log('loadRequestData.media.customData.metadata', loadRequestData.media.customData.metadata);

    if (loadRequestData.media.customData && loadRequestData.media.customData.metadata) {
      console.info('received some metadata from the Bitmovin Player', loadRequestData.media.customData.metadata);
      const { media: { customData: {metadata: { contentId, requestChannel, ascendontoken, entitlementtoken }}}} = loadRequestData;
      const manifestReqUrl = `${location.origin}/2.0/R/ENG/${requestChannel}/ALL/CONTENT/PLAY?contentId=${contentId}`;
      const headers = {
        ascendontoken,
        entitlementtoken,
        'x-f1-override-view': 'live'
      }

      console.log('headers', headers);

      return fetch(
        manifestReqUrl,
        {
          headers
        }
      )
        .then((res) => res.json())
        .then(res => {
          // @ts-ignore
          const { resultObj: { url = '' } = {}, message } = res;

          console.log('res', res);

          if (message === '200') {
            loadRequestData = this.checkIfHLS(loadRequestData, url);
            loadRequestData = this.setCredentialsRules(loadRequestData);
            if (loadRequestData.media.customData && loadRequestData.media.customData.drm) {
              return this.setDRM(loadRequestData);
            }
            return loadRequestData;
          } else {
            console.log('something went wrong while performing PlayAPI request', message)
          }
          return loadRequestData
        });
    } else {
      loadRequestData = this.checkIfHLS(loadRequestData);
    }

    loadRequestData = this.setCredentialsRules(loadRequestData);
    if (loadRequestData.media.customData && loadRequestData.media.customData.drm) {
      return this.setDRM(loadRequestData);
    }

    return loadRequestData;
  }

  private setCredentialsRules(loadRequestData: LoadRequestData): LoadRequestData {
    this.context.getPlayerManager().setMediaPlaybackInfoHandler((_loadRequest, playbackConfig) => {

      playbackConfig.manifestRequestHandler = requestInfo => {
        requestInfo.withCredentials = true;
      };

      playbackConfig.segmentRequestHandler = requestInfo => {
        requestInfo.withCredentials = true;
      };

      playbackConfig.licenseRequestHandler = requestInfo => {
        requestInfo.withCredentials = true;
      };
      return playbackConfig;
    });

    return loadRequestData;
  }

  private setDRM(loadRequestData: LoadRequestData): LoadRequestData {
    const { protectionSystem, licenseUrl, headers, withCredentials } = loadRequestData.media.customData.drm;
    this.context.getPlayerManager().setMediaPlaybackInfoHandler((_loadRequest, playbackConfig) => {
      playbackConfig.licenseUrl = licenseUrl;
      playbackConfig.protectionSystem =  protectionSystem;

      if (typeof headers === 'object') {
        playbackConfig.licenseRequestHandler = requestInfo => {
          requestInfo.headers = headers;
        };
      }

      if (withCredentials) {
        playbackConfig.licenseRequestHandler = setWithCredentialsFlag;
      }

      console.log('playbackConfig', playbackConfig);
      return playbackConfig;
    });
    console.log('loadRequestData', loadRequestData);
    return loadRequestData;
  }

  private readonly onCustomMessage = (message: cast.framework.system.Event) => {
    const { data } = message;
    const { action = '', config = {}, audioTrackLabel = ''} = data.data || data;
    const { context } = this;

    console.log('custom message', message);

    if (action === 'ANALYTICS_CONFIG_RECEIVED') {
      new CAFv3Adapter(config, context);
    }

    if (action === 'CONTENT_LANGUAGE_LABEL') {
      this.currentAudioTrackSelected = audioTrackLabel;
    }
    // if (message.data?.data?.action === 'STOP') {
    //   this.context.stop();
    //   cast.framework.CastContext.getInstance().endCurrentSession(true)
    // }
  }
}

function setWithCredentialsFlag(requestInfo: NetworkRequestInfo): void {
  requestInfo.withCredentials = true;
}
