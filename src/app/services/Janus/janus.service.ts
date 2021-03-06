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
        debug: ['trace', 'warn', 'error'],
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
            Janus.log(
              'Unsuccessfully registered as ' + result['username'] + '!'
            );
            subscriber.next({
              message: fromModels.ON_REGISTERED_FAIL,
              payload: { result },
            });

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
        // console.log('No deberia caer aqui 1');
        // console.log(stream);
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

  test(): Observable<fromModels.JanusAttachCallbackData> {
    // Create session
    const instance = this;
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

  unPublishOwnFeed(): void {
    // Unpublish your own feed
    const unpublish = { request: 'unpublish' };
    this.handle.send({ message: unpublish });
    this.cleanupLocalStream();
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
    this.server = data.server;
    this.user = data.user;
    this.password = data.password;
    this.authUser = data.authUser;
    this.displayName = data.displayName;
    this.janusServer = data.janusServer;
  }

  llamar(numero: string): void {
    this._createOffer(`sip:772051${numero}@${this.server}`);
  }

  colgar(): void {
    this.handle.hangup();
  }

  log(method, obj, msg = null): void {
    if ((msg = null)) {
      Janus[method](obj);
      return;
    }
    Janus[method](msg, obj);
  }
}
