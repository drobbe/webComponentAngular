import { Injectable } from '@angular/core';

import { Observable, of, interval } from 'rxjs';
import { tap, takeWhile } from 'rxjs/operators';

import Janus from '../3rdparty/janus.es';

import * as fromModels from '../../interfaces/janus';
import {
  RemoteFeed,
  RoomInfo,
  IceServer,
  InitData,
} from '../../interfaces/janus';

/**
 * Various helper functions for querying devices
 */
@Injectable({
  providedIn: 'root',
})
export class WebrtcService {
  // Wrappers around some common webrtc functions

  constructor() {}

  /**
   * Wrapper around getUserMedia that allows the user to specify the audio and video device ids
   *
   * @param audioDeviceId Device ID of the desired audio device. If null, audio will not be included
   * @param videoDeviceId Device ID of the desired video device.
   */
  getUserMedia(
    audioDeviceId: string | null,
    videoDeviceId: string
  ): Promise<MediaStream> {
    const constraints = {
      audio: audioDeviceId !== null ? { deviceId: audioDeviceId } : false,
      video: { deviceId: videoDeviceId, width: 1920, height: 1080 },
    };
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  /**
   * Wrapper around `navigator.mediaDevices.enumerateDevices`
   */
  listDevices(): Promise<any> {
    return navigator.mediaDevices.enumerateDevices();
  }

  /**
   * Returns the device IDs for the default audio, video, and speaker device
   */
  async getDefaultDevices(): Promise<{
    audioDeviceId: string;
    videoDeviceId: string;
    speakerDeviceId;
  }> {
    const devices = await this.listDevices();
    const audioDevices = devices.filter(
      (device) => device.kind === 'audioinput'
    );
    const videoDevices = devices.filter(
      (device) => device.kind === 'videoinput'
    );
    const speakerDevices = devices.filter(
      (device) => device.kind === 'audiooutput'
    );
    const audioDeviceId =
      audioDevices.length < 1 ? null : audioDevices[0].deviceId;
    const videoDeviceId =
      videoDevices.length < 1 ? null : videoDevices[0].deviceId;
    const speakerDeviceId =
      speakerDevices.length < 1 ? null : speakerDevices[0].deviceId;

    return { audioDeviceId, videoDeviceId, speakerDeviceId };
  }

  /**
   * Determines if the current platform supports setting the speaker. Some devices, e.g., most android
   * phones, do not allow the dynamic setting of the speaker from within the browser. For those devices,
   * it's necessary to change the output device outside of the browser.
   */
  supportsSpeakerSelection(): boolean {
    const videoElement = document.createElement('video');
    const support = 'setSinkId' in videoElement;
    videoElement.remove();
    return support;
  }

  /**
   * Determines if the current device is supported. Currently, iPhone 6 and older are not supported.
   */
  isSupportedDevice(): boolean {
    return this.supportsAppVersion(navigator.appVersion);
  }

  /**
   * Clear all resources for a previously created media stream
   */
  clearMediaStream(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      track.stop();
      stream.removeTrack(track);
    }
  }

  /** @internal */
  supportsAppVersion(appVersion: string): boolean {
    // returns true iff it supports the device identified by the supplied navigator.appVersion string
    const match = appVersion
      ? appVersion.match(/iPhone OS (\d+)_(\d+)/)
      : false;
    if (!match) {
      return true;
    }
    const version = [parseInt(match[1], 10), parseInt(match[2], 10)];

    return version[0] >= 13;
  }
}

/** @internal */
@Injectable({
  providedIn: 'root',
})
export class JanusService {
  private streams = {};
  private initialized = false;
  private janus: any;
  private server: String;
  private user: String;
  private password: String;
  private authUser: String;
  private displayName: String;
  private janusServer: String;
  private opaqueId: String = this.randomString(16);
  public handle; // Handle to the videoroom plugin
  private remoteHandles: { [id: number]: any } = {}; // Handles to remote streams

  private videoElement: any;
  private localStream: any;
  private publishWebrtcState = false;

  private drawLoopActive: boolean;
  private iceServers: { urls: string }[];

  constructor(private webrtcService: WebrtcService) {}

  init(iceServers: IceServer[]): Observable<any> {
    // Initialize Janus
    this.iceServers = iceServers;

    if (this.initialized) {
      console.log('Warning: called janus init twice');
      return of(true);
    }

    return new Observable((subscriber) => {
      Janus.init({
        debug: 'all',
        callback(): void {
          // Make sure the browser supports WebRTC
          if (!Janus.isWebrtcSupported()) {
            subscriber.error('WebRTC is not supported');
          }
          subscriber.next();
          subscriber.complete();
        },
      });
    });
  }

  randomString(bytes: number): string {
    const array = new Uint8Array(bytes);
    window.crypto.getRandomValues(array);

    // Real pain to find a cross platform way to do this smoothly. Dropping into a for loop
    let ret = '';
    for (const item of array) {
      ret += item.toString(36);
    }

    return ret;
  }

  destroy(): void {
    const leave = { request: 'leave' };

    if (this.handle) {
      this.handle.send({ message: leave });
    }
    this.cleanupLocalStream();
    this.janus.destroy({ unload: true });

    // Clean up all variables used
    this.janus = null;
    this.handle = null;
    this.streams = {};
    this.initialized = false;
    this.janus = null;
    this.server = null;
    this.handle = null;
    this.remoteHandles = {};
    this.videoElement = null;
    this.localStream = null;
    this.publishWebrtcState = false;
    this.drawLoopActive = null;
    this.iceServers = [];
  }

  cleanupLocalStream(): void {
    if (this.videoElement) {
      this.videoElement.remove();
    }
    if (this.localStream) {
      this.webrtcService.clearMediaStream(this.localStream);
    }
    this.drawLoopActive = false;
  }

  _get_random_string(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }

  _attachVideoRoomHelper(subscriber): void {
    const instance = this;
    this.janus.attach({
      plugin: 'janus.plugin.videoroom',
      opaqueId: this.opaqueId,
      success(pluginHandle): void {
        instance.handle = pluginHandle;
        subscriber.next({
          message: fromModels.ATTACH_SUCCESS,
        });
      },
      error(error): void {
        subscriber.error(error);
      },
      consentDialog(on): void {
        subscriber.next({
          message: fromModels.CONSENT_DIALOG,
          payload: { on },
        });
      },
      mediaState(medium, on): void {
        subscriber.next({
          message: fromModels.MEDIA_STATE,
          payload: { medium, on },
        });
      },
      webrtcState(on): void {
        instance.publishWebrtcState = on;
        subscriber.next({
          message: fromModels.WEBRTC_STATE,
          payload: { on },
        });
      },
      iceState(arg1, arg2): void {
        // console.log('ICE STATE', arg1, arg2);
      },
      slowLink(msg): void {},
      onmessage(msg, jsep): void {
        subscriber.next({
          message: fromModels.ON_MESSAGE,
          payload: { msg, jsep },
        });
        if (!!jsep) {
          instance.handleRemoteJsep(jsep);
        }
      },
      onlocalstream(stream): void {
        const streamId = instance._get_random_string();
        instance.streams[streamId] = stream;
        subscriber.next({
          message: fromModels.ON_LOCAL_STREAM,
          payload: { stream_id: streamId },
        });
      },
      onremotestream(stream): void {
        // Don't expect this to ever happen
        subscriber.next({
          message: fromModels.ON_REMOTE_STREAM,
          payload: { stream },
        });
      },
      oncleanup(): void {
        subscriber.next({
          message: fromModels.ON_CLEANUP,
        });
      },
    });
  }

  _attachSip(subscriber): void {
    const instance = this;
    this.janus.attach({
      plugin: 'janus.plugin.sip',
      opaqueId: this.opaqueId,
      success(pluginHandle): void {
        instance.handle = pluginHandle;
        console.log('pluginHandle', pluginHandle);

        subscriber.next({
          message: fromModels.ATTACH_SUCCESS,
        });

        setTimeout(() => {
          pluginHandle.send({
            message: {
              request: 'register',
              username: `sip:${instance.user}@${instance.server}`,
              authuser: instance.authUser,
              display_name: instance.displayName,
              secret: instance.password,
              //proxy: 'sip:34.95.187.108:5060',
            },
          });
        }, 5000);
      },
      error: function (error) {
        Janus.error('  -- Error attaching plugin...', error);
        // bootbox.alert('  -- Error attaching plugin... ' + error);
      },
      consentDialog: function (on) {
        Janus.debug('Consent dialog should be ' + (on ? 'on' : 'off') + ' now');
      },
      iceState: function (state) {
        Janus.log('ICE state changed to ' + state);
      },
      mediaState: function (medium, on) {
        Janus.log(
          'Janus ' + (on ? 'started' : 'stopped') + ' receiving our ' + medium
        );
      },
      webrtcState: function (on) {
        Janus.log(
          'Janus says our WebRTC PeerConnection is ' +
            (on ? 'up' : 'down') +
            ' now'
        );
      },
      onmessage: function (msg, jsep) {
        Janus.debug(' ::: Got a message :::', msg);

        // Any error?
        let error = msg['error'];
        if (error) {
          subscriber.next({
            message: fromModels.ON_ERROR,
            payload: { error },
          });
          return;
        }

        let callId = msg['call_id'];
        let result = msg['result'];
        if (result && result['event']) {
          let event = result['event'];
          if (event === 'registration_failed') {
            Janus.warn(
              'Registration failed: ' + result['code'] + ' ' + result['reason']
            );

            return;
          }
          if (event === 'registered') {
            Janus.log('Successfully registered as ' + result['username'] + '!');
            subscriber.next({
              message: fromModels.ON_REGISTERED,
              payload: { result },
            });
          } else if (event === 'calling') {
            Janus.log('Waiting for the peer to answer...');
            subscriber.next({
              message: fromModels.ON_CALLING,
              payload: { result },
            });
          } else if (event === 'incomingcall') {
            Janus.log('Incoming call from ' + result['username'] + '!');
            instance.handle.callId = callId;
            subscriber.next({
              message: fromModels.ON_INCOMINGCALL,
              payload: { result, jsep },
            });
          } else if (event === 'accepting') {
            // Response to an offerless INVITE, let's wait for an 'accepted'
          } else if (event === 'progress') {
            Janus.log(
              "There's early media from " +
                result['username'] +
                ', wairing for the call!',
              jsep
            );
            subscriber.next({
              message: fromModels.ON_PROGRESS,
              payload: { result, jsep },
            });
            // Call can start already: handle the remote answer
          } else if (event === 'accepted') {
            Janus.log(result['username'] + ' accepted the call!', jsep);
            instance.handle.callId = callId;
            subscriber.next({
              message: fromModels.ON_ACCEPTED,
              payload: { result, jsep },
            });
          } else if (event === 'updatingcall') {
            Janus.log('Got re-INVITE');
            subscriber.next({
              message: fromModels.ON_UPDATING_CALL,
              payload: { result, jsep },
            });
          } else if (event === 'message') {
            var sender = result['displayname']
              ? result['displayname']
              : result['sender'];
            var content = result['content'];
            content = content.replace(new RegExp('<', 'g'), '&lt');
            content = content.replace(new RegExp('>', 'g'), '&gt');
            console.log(content, 'Message from ' + sender);
          } else if (event === 'info') {
            // We got an INFO
            var sender = result['displayname']
              ? result['displayname']
              : result['sender'];
            var content = result['content'];
            content = content.replace(new RegExp('<', 'g'), '&lt');
            content = content.replace(new RegExp('>', 'g'), '&gt');
            console.log(content, 'Info from ' + sender);
          } else if (event === 'notify') {
            // We got a NOTIFY
            var notify = result['notify'];
            var content = result['content'];
            console.log(content, 'Notify (' + notify + ')');
          } else if (event === 'transfer') {
          } else if (event === 'hangup') {
            Janus.log(
              'Call hung up (' + result['code'] + ' ' + result['reason'] + ')!'
            );
            subscriber.next({
              message: fromModels.ON_HANGUP,
              payload: { result },
            });
            instance.handle.hangup();
          }
        }
      },
      onlocalstream: function (stream) {
        console.log('No deberia caer aqui 1');
        console.log(stream);
      },
      onremotestream: function (stream) {
        subscriber.next({
          message: fromModels.ON_REMOTE_STREAM,
          payload: { stream },
        });
      },
      oncleanup: function () {
        Janus.log(' ::: Got a cleanup notification :::');
        if (instance.handle) instance.handle.callId = null;
      },
    });
  }

  attachVideoRoom(url): Observable<fromModels.JanusAttachCallbackData> {
    // Create session
    const instance = this;
    return new Observable((subscriber) => {
      instance.janus = new Janus({
        server: url,
        iceServers: this.iceServers,
        success: () => {
          instance._attachVideoRoomHelper(subscriber);
        },
        error(error): void {
          subscriber.error(error);
        },
        destroyed(): void {
          // window.location.reload();
        },
      });
    });
  }

  test(): Observable<fromModels.JanusAttachCallbackData> {
    // Create session
    const instance = this;
    console.log('intance', instance);
    return new Observable((subscriber) => {
      instance.janus = new Janus({
        server: instance.janusServer,
        iceServers: this.iceServers,
        success: () => {
          instance._attachSip(subscriber);
        },
        error(error): void {
          subscriber.error(error);
        },
        destroyed(): void {
          // window.location.reload();
        },
      });
    });
  }

  register(
    name: string,
    userId: string,
    roomId: string | number,
    pin: string
  ): void {
    const register = {
      request: 'join',
      room: roomId,
      ptype: 'publisher',
      display: name,
      id: userId,
      pin,
    };
    this.handle.send({ message: register });
  }

  handleRemoteJsep(jsep): void {
    this.handle.handleRemoteJsep({
      jsep,
      error: console.log('error handleRemoteJsep', 'doHangup'),
    });
  }

  answerRemoteFeedJsep(jsep, feed: RemoteFeed, room: RoomInfo): void {
    // Handle a jsep message for a remote feed

    const handle = this.remoteHandles[feed.id];
    handle.createAnswer({
      jsep,
      trickle: true,
      media: { audioSend: false, videoSend: false }, // We want recvonly audio/video
      success(jsepBody): void {
        const body = { request: 'start', room: room.id };
        handle.send({ message: body, jsep: jsepBody });
      },
      error(error): void {
        console.log('ERROR in JSEP RESPONSE', error);
      },
    });
  }

  draw(canvasContext, videoElement): void {
    canvasContext.drawImage(videoElement, 0, 0);
    const centerX = canvasContext.canvas.width / 2;
    const centerY = canvasContext.canvas.height / 2;
    const videoWidth = videoElement.videoWidth;
    const videoHeight = videoElement.videoHeight;

    canvasContext.fillStyle = '#000';
    canvasContext.fillRect(
      0,
      0,
      canvasContext.canvas.width,
      canvasContext.canvas.height
    );

    canvasContext.save();
    canvasContext.translate(centerX, centerY);
    canvasContext.drawImage(
      videoElement,
      -videoWidth / 2,
      -videoHeight / 2,
      videoWidth,
      videoHeight
    );
    canvasContext.restore();
  }

  startDrawingLoop(canvasElement, videoElement, frameRate: number): void {
    // Drawing loop using AudioContext oscillator. requestAnimationFrame doesn't fire
    // on background tabs, so this is a hack to make this work when the user switches tabs

    const instance = this;
    instance.drawLoopActive = true;
    const canvasContext = canvasElement.getContext('2d');

    const stepMilliSeconds = 1000 / frameRate;

    function step(): void {
      if (instance.drawLoopActive) {
        instance.draw(canvasContext, videoElement);
        setTimeout(step, stepMilliSeconds);
        // requestAnimationFrame(step);
      }
    }
    step();
  }

  _muteVideo(videoElement): void {
    // Mute a given video element

    const instance = this;
    function mute(event): void {
      videoElement.muted = 'muted';
      videoElement.removeEventListener('playing', mute);
    }

    videoElement.addEventListener('playing', mute);
  }

  _sizeCanvasElement(
    videoWidth: number,
    videoHeight: number
  ): { canvasWidth: number; canvasHeight: number } {
    // We're keeping the height the same. Goal is to add black bars to the sides
    // if we're in portrait mode and crop to the center if we're in landscape.
    return {
      canvasWidth: (videoHeight * 4) / 3,
      canvasHeight: videoHeight,
    };
  }

  _videoElementSafariHacks(videoElement): void {
    // safari requires that the video element be in the body
    const body = document.getElementsByTagName('body')[0];
    body.appendChild(videoElement);
    videoElement.setAttribute('style', 'width: 0; height: 0;');

    // safari doesn't always auto-play the way you'd like it to
    videoElement.addEventListener('canplay', () => videoElement.play());
  }

  _createVideoElement(canvasId: string, videoStream: any): any {
    // Create the video element and attach it to the canvas

    const videoElement = document.createElement('video');
    const canvasElement: any = document.getElementById(canvasId);

    // Firefox has a bug where calling captureStream before calling getContext results in an error.
    canvasElement.getContext('2d');

    const canvasStream = canvasElement.captureStream();
    const videoSettings = videoStream.getVideoTracks()[0].getSettings();

    this._videoElementSafariHacks(videoElement);

    Janus.attachMediaStream(videoElement, videoStream);
    videoElement.autoplay = true;
    videoElement.setAttribute('playsinline', 'true');
    videoElement.setAttribute('id', 'self-video');

    // Some browsers don't like it if we set the muted attribute before the video is playing
    this._muteVideo(videoElement);

    const { canvasWidth, canvasHeight } = this._sizeCanvasElement(
      videoSettings.width,
      videoSettings.height
    );
    canvasElement.width = canvasWidth;
    canvasElement.height = canvasHeight;

    const audioTrack = videoStream.getAudioTracks().find((item) => item);
    if (!!audioTrack) {
      canvasStream.addTrack(videoStream.getAudioTracks()[0]);
    }

    this.startDrawingLoop(canvasElement, videoElement, videoSettings.frameRate);

    return {
      videoElement,
      canvasStream,
    };
  }

  unPublishOwnFeed(): void {
    // Unpublish your own feed
    const unpublish = { request: 'unpublish' };
    this.handle.send({ message: unpublish });
    this.cleanupLocalStream();
  }

  publishOwnFeed(
    audioDeviceId: string | null,
    videoDeviceId: string,
    canvasId: string = 'canvas-self',
    skipVideoCapture: boolean = false
  ): Observable<boolean> {
    // Publish our own feed

    return new Observable((subscriber) => {
      if (this.publishWebrtcState) {
        // Already publishing. Need to unpublish, wait until we're done unpublishing, and then republish
        this.unPublishOwnFeed();
      }

      // Wait until we're not publishing before starting to publish again. Note that
      // this will immediately complete if we haven't started publishing yet.
      interval(100)
        .pipe(takeWhile(() => this.publishWebrtcState))
        .subscribe({
          complete: () => {
            this.createStreamAndOffer(
              subscriber,
              audioDeviceId,
              videoDeviceId,
              canvasId,
              skipVideoCapture
            );
          },
        });
    });
  }

  createStreamAndOffer(
    subscriber,
    audioDeviceId: string | null,
    videoDeviceId: string,
    canvasId: string,
    skipVideoCapture: boolean,
    retryCount = 0
  ): void {
    const instance = this;
    return;
    if (skipVideoCapture) {
      // We don't create any video element, etc.
      const canvasElement: any = document.getElementById(canvasId);
      const canvasStream = canvasElement.captureStream();
      //return this.createOffer(subscriber, canvasStream);
    } else {
      // Common case. We need to create a video element
      instance.webrtcService
        .getUserMedia(audioDeviceId, videoDeviceId)
        .then((videoStream) => {
          instance.localStream = videoStream;
          const { videoElement, canvasStream } = instance._createVideoElement(
            canvasId,
            videoStream
          );
          instance.videoElement = videoElement;
          // this.createOffer(subscriber, canvasStream);
        })
        .catch((error) => {
          // Some devices get intermittent errors. I'm doing a retry here. Not a warm-fuzzy solution. Future work might
          // find a race condition where we need to wait for an event before calling getUserMedia
          if (retryCount < 5) {
            setTimeout(() => {
              instance.createStreamAndOffer(
                subscriber,
                audioDeviceId,
                videoDeviceId,
                canvasId,
                skipVideoCapture,
                retryCount + 1
              );
            }, 1000);
          }
        });
    }
  }

  llamar(numero: string): void {
    this._createOffer(`sip:772051${numero}@${this.server}`);
  }

  colgar(): void {
    this.handle.hangup();
  }

  _createOffer(uri: string): void {
    const instance = this;
    instance.handle.createOffer({
      media: {
        audioSend: true,
        audioRecv: true, // We DO want audio
        videoSend: false,
        videoRecv: false, // We MAY want video
      },
      success: function (jsep) {
        console.log(jsep);
        var body = {
          request: 'call',
          uri: uri,
        };
        instance.handle.send({ message: body, jsep: jsep });
      },
      error: function (error) {
        instance.handle.alert('WebRTC error... ' + error.message);
      },
    });
  }

  attachMediaStream(element: any, stream: any): void {
    // const element
    Janus.attachMediaStream(element, stream);
  }

  attachRemoteFeed(
    feed: RemoteFeed,
    room: RoomInfo,
    pin: string
  ): Observable<fromModels.JanusAttachCallbackData> {
    // A new feed has been published, create a new plugin handle and attach to it as a subscriber

    const instance = this;

    return new Observable((subscriber) => {
      instance.janus.attach({
        plugin: 'janus.plugin.videoroom',
        opaqueId: instance.opaqueId,
        success(pluginHandle): void {
          instance.remoteHandles[feed.id] = pluginHandle;
          instance.remoteHandles[feed.id].videoCodec = feed.video_codec;

          const subscribe = {
            request: 'join',
            room: room.id,
            ptype: 'subscriber',
            feed: feed.id,
            private_id: room.privateId,
            substream: 0,
            pin,
          };
          instance.remoteHandles[feed.id].send({ message: subscribe });
        },

        error(error): void {
          subscriber.error(error);
        },

        onmessage(msg, jsep): void {
          subscriber.next({
            message: fromModels.ON_REMOTE_FEED_MESSAGE,
            payload: {
              msg,
              jsep,
              feed,
              room,
            },
          });
          if (!!jsep) {
            instance.answerRemoteFeedJsep(jsep, feed, room);
          }
        },

        webrtcState(on): void {
          subscriber.next({
            message: fromModels.REMOTE_FEED_WEBRTC_STATE,
            payload: {
              on,
              feed,
              room,
            },
          });
        },

        onlocalstream(stream): void {
          console.log('Would never expect to get here');
        },

        slowLink(msg): void {
          subscriber.next({
            message: fromModels.REMOTE_FEED_SLOW_LINK,
            payload: {
              feedId: feed.id,
            },
          });
        },

        onremotestream(stream): void {
          // Save off remote stream

          const streamId = instance._get_random_string();
          instance.streams[streamId] = stream;

          const numVideoTracks = stream.getVideoTracks()
            ? stream.getVideoTracks().length
            : 0;
          subscriber.next({
            message: fromModels.ON_REMOTE_REMOTE_STREAM,
            payload: {
              streamId,
              numVideoTracks,
              feed,
              room,
            },
          });
        },
        oncleanup(): void {
          subscriber.next({
            message: fromModels.ON_REMOTE_CLEANUP,
            payload: {
              feed,
              room,
            },
          });
        },
      });
    });
  }

  toggleMute(): boolean {
    const muted = this.handle.isAudioMuted();
    if (muted) {
      this.handle.unmuteAudio();
    } else {
      this.handle.muteAudio();
    }
    return this.handle.isAudioMuted();
  }

  setMute(mute: boolean): boolean {
    const muted = this.handle.isAudioMuted();
    if (muted === mute) {
      return this.handle.isAudioMuted();
    }

    if (mute) {
      this.handle.muteAudio();
    } else {
      this.handle.unmuteAudio();
    }
    return this.handle.isAudioMuted();
  }

  requestSubstream(feed: RemoteFeed, substreamId: number): void {
    this.remoteHandles[feed.id].send({
      message: { request: 'configure', substream: substreamId },
    });
  }

  handlePluging(method: string, param: any): void {
    const instance = this;
    instance.handle[method](param);
  }

  createAnswer(offerlessInvite: boolean, jsep: any): void {
    const instance = this.handle;

    let sipcallAction = offerlessInvite
      ? instance.createOffer
      : instance.createAnswer;

    sipcallAction({
      jsep: jsep,
      media: { audio: true, video: false },
      success: function (jsep) {
        var body = { request: 'accept' };

        instance.send({ message: body, jsep: jsep });
      },
      error: function (error) {
        Janus.error('[Helper] WebRTC error:', error);

        var body = { request: 'decline', code: 480 };
        instance.send({ message: body });
      },
    });
  }

  setData(data: InitData) {
    console.log('!!!!!!!!');
    this.server = data.server;
    this.user = data.user;
    this.password = data.password;
    this.authUser = data.authUser;
    this.displayName = data.displayName;
    this.janusServer = data.janusServer;
  }
}
