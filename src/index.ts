import { CastReceiverContext, PlayerManager, PlaybackConfig } from 'chromecast-caf-receiver/cast.framework';
import { LoadRequestData } from 'chromecast-caf-receiver/cast.framework.messages';
import { CAFv3Adapter } from 'bitmovin-analytics';

const CAST_MESSAGE_NAMESPACE = 'urn:x-cast:com.formula1.player.caf';

export default class CAFReceiver {
  private readonly player: PlayerManager;
  private readonly context: CastReceiverContext;
  private readonly playbackConfig: PlaybackConfig;

  constructor() {
    this.context = cast.framework.CastReceiverContext.getInstance();
    this.player = this.context.getPlayerManager();
    this.playbackConfig = new cast.framework.PlaybackConfig();
  }

  public init() {
    cast.framework.CastReceiverContext.getInstance().setLoggerLevel(cast.framework.LoggerLevel.DEBUG);

    this.attachEvents();
    this.context.start();
    cast.framework.CastReceiverContext.getInstance().setInactivityTimeout(Number.MAX_VALUE)
  }

  private attachEvents() {
    this.player.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, this.onLoad);
    this.context.addCustomMessageListener(CAST_MESSAGE_NAMESPACE, this.onCustomMessage);
  }

  // Setup DRM if present in `media.customData`
  private readonly onLoad = (loadRequestData: LoadRequestData): LoadRequestData => {
    console.log('LOAD Request', loadRequestData);
    const { media } = loadRequestData;
    const { contentId, contentUrl } = media || {};
    const url = contentId || contentUrl;

    // fallback to support current Bitmovin v2 sender app
    if(contentId && contentId.indexOf('{') > -1) {
      const parsedData = JSON.parse(contentId);
      loadRequestData.media.contentId = parsedData.hls || parsedData.dash;
      // console.log('parsed',parsedData);
    }

    if(!url?.includes('/f1vodprod/')
      && !url?.includes('/hls/')
      && !url?.includes('/dash/')
      && !url?.includes('/out/v1/')
    ) {
      loadRequestData.media.hlsSegmentFormat = cast.framework.messages.HlsSegmentFormat.TS;
    }

    loadRequestData = this.setCredentialsRules(loadRequestData);
    if (loadRequestData.media.customData && loadRequestData.media.customData.drm) {
      return this.setDRM(loadRequestData);
    }

    // loadRequestData.media.hlsSegmentFormat = cast.framework.messages.HlsSegmentFormat.TS;
    // console.log('loadRequestData.media.hlsSegmentFormat', loadRequestData.media.hlsSegmentFormat)
    return loadRequestData;
  }

  private setCredentialsRules(loadRequestData: LoadRequestData): LoadRequestData {
    this.context.getPlayerManager().setMediaPlaybackInfoHandler((_loadRequest, playbackConfig) => {

      playbackConfig.manifestRequestHandler = requestInfo => {
        requestInfo.withCredentials = true;
        //console.log('manifestRequestHandler', requestInfo)
      };

      playbackConfig.segmentRequestHandler = requestInfo => {
        requestInfo.withCredentials = true;
        //console.log('segmentRequestHandler', requestInfo)
      };

      playbackConfig.licenseRequestHandler = requestInfo => {
        requestInfo.withCredentials = true;
        // console.log('licenseRequestHandler', requestInfo)
      };
      // console.log('playbackConfig', this.context.getPlayerManager().getPlaybackConfig());
      return playbackConfig;
    });

    return loadRequestData;
  }

  private setDRM(loadRequestData: LoadRequestData): LoadRequestData {
    const protectionSystem = loadRequestData.media.customData.drm.protectionSystem;
    const licenseUrl = loadRequestData.media.customData.drm.licenseUrl;
    this.context.getPlayerManager().setMediaPlaybackInfoHandler((_loadRequest, playbackConfig) => {
      playbackConfig.licenseUrl = licenseUrl;
      playbackConfig.protectionSystem =  protectionSystem;

      if (typeof loadRequestData.media.customData.drm.headers === 'object') {
        playbackConfig.licenseRequestHandler = requestInfo => {
          requestInfo.headers = loadRequestData.media.customData.drm.headers;
        };
      }

      return playbackConfig;
    });

    return loadRequestData;
  }

  private readonly onCustomMessage = (message: cast.framework.system.Event) => {
    const { data : { data: { action = '', config = {}} = {}}} = message;
    const { context } = this;
    if (action === 'ANALYTICS_CONFIG_RECEIVED') {
      new CAFv3Adapter(config, context);
    }
    // if (message.data?.data?.action === 'STOP') {
    //   this.context.stop();
    //   cast.framework.CastContext.getInstance().endCurrentSession(true)
    // }
  }
}
