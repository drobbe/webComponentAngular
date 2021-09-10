import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import { Observable } from 'rxjs/internal/Observable';
import { JanusService } from '../services/Janus/janus.service';
@Component({
  selector: 'webphone',
  templateUrl: './webphone.component.html',
  styleUrls: ['./webphone.component.css'],
})
export class WebphoneComponent implements OnInit {
  jsep: any;

  /** @internal */
  @ViewChild('videoElement') videoElement: ElementRef;
  janusLoader: Observable<any>;
  enLlamada = false;
  entrante = false;
  registered = false;
  offerlessInvite: any;
  Server: String;
  User: String;
  Password: String;
  AuthUser: String;
  DisplayName: String;
  JanusServer: String;
  @Output('event-listener') eventListener = new EventEmitter();

  constructor(private janusService: JanusService) {}

  ngOnInit(): void {
    this.Server = sessionStorage.getItem('Server');
    this.User = sessionStorage.getItem('User');
    this.Password = sessionStorage.getItem('Password');
    this.AuthUser = sessionStorage.getItem('AuthUser');
    this.DisplayName = sessionStorage.getItem('DisplayName');
    this.JanusServer = sessionStorage.getItem('JanusServer');
  }

  ngAfterViewInit(): void {
    let clase = this;
    console.log(this.Server);
    console.log(this.JanusServer);
    this.janusService.setData({
      server: this.Server,
      user: this.User,
      password: this.Password,
      displayName: this.DisplayName,
      authUser: this.AuthUser,
      janusServer: this.JanusServer,
    });

    this.janusLoader = this.janusService.init([]);

    this.janusLoader.subscribe(
      (x) => console.log('janusLoader got a next value: ' + x),
      (err) => console.error('janusLoader got an error: ' + err),
      () => console.log('janusLoader got a complete notification')
    );

    this.janusService.test().subscribe(
      (x) => {
        if (x.message === 'remote stream') {
          clase.janusService.attachMediaStream(
            clase.videoElement.nativeElement,
            x.payload.stream
          );
        }

        if (x.message === 'error') {
          clase.eventListener.emit({ ...x, ...{ type: 'error' } });
          if (clase.registered) {
            // Reset status
            console.log('Cortar llamada ???');
          } else {
            // Reset status
            console.log('Cortar llamada ???');
          }
        }

        if (x.message === 'registration_failed') {
          if (clase.registered) {
            // Reset status
            console.log('Cortar llamada ???');
          }
          clase.eventListener.emit({
            ...x,
            ...{ type: 'registration_failed' },
          });
        }

        if (x.message === 'registered') {
          clase.registered = true;
          clase.eventListener.emit({ ...x, ...{ type: 'registered' } });
        }

        if (x.message === 'calling') {
          clase.eventListener.emit({ ...x, ...{ type: 'calling' } });
        }

        if (x.message === 'incoming call') {
          clase.eventListener.emit({ ...x, ...{ type: 'incoming call' } });

          let doAudio = true,
            doVideo = true;
          let offerlessInvite = false;
          // What has been negotiated?
          doAudio = x.payload.jsep.sdp.indexOf('m=audio ') > -1;
          doVideo = x.payload.jsep.sdp.indexOf('m=video ') > -1;
          // console.log(
          //   'Audio ' + (doAudio ? 'has' : 'has NOT') + ' been negotiated'
          // );
          // console.log(
          //   'Video ' + (doVideo ? 'has' : 'has NOT') + ' been negotiated'
          // );

          if (x.payload.jsep) {
          } else {
            console.log(
              "This call doesn't contain an offer... we'll need to provide one ourselves"
            );
            offerlessInvite = true;
            // In case you want to offer video when reacting to an offerless call, set this to true
            doVideo = false;
          }
          // Is this the result of a transfer?
          let transfer = '';
          let referredBy = x.payload.result['referred_by'];
          if (referredBy) {
            transfer = ' (referred by ' + referredBy + ')';
            transfer = transfer.replace(new RegExp('<', 'g'), '&lt');
            transfer = transfer.replace(new RegExp('>', 'g'), '&gt');
          }
          // Any security offered? A missing "srtp" attribute means plain RTP
          let rtpType = '';
          let srtp = x.payload.result['srtp'];
          if (srtp === 'sdes_optional') rtpType = ' (SDES-SRTP offered)';
          else if (srtp === 'sdes_mandatory')
            rtpType = ' (SDES-SRTP mandatory)';
          // Notify user
          // bootbox.hideAll();
          let extra = '';
          if (offerlessInvite) extra = ' (no SDP offer provided)';

          clase.jsep = x.payload.jsep;
          clase.offerlessInvite = offerlessInvite;
          clase.entrante = true;
          console.log('Aviso', 'LLamada Entrante !!!', 'Primary');
          setTimeout(() => {
            clase.contestar();
          }, 1000);
          //clase.janusService.createAnswer(offerlessInvite, x.payload.jsep);
        }
        if (x.message === 'progress') {
          if (x.payload.jsep) {
            clase.janusService.handleRemoteJsep(x.payload.jsep);
          }
        }
        if (x.message === 'accepted') {
          clase.enLlamada = true;
          if (x.payload.jsep) {
            clase.janusService.handleRemoteJsep(x.payload.jsep);
          }
        }

        if (x.message === 'updating call') {
          if (x.payload.jsep) {
            var doAudio = x.payload.sdp.indexOf('m=audio ') > -1,
              doVideo = x.payload.sdp.indexOf('m=video ') > -1;
            clase.janusService.handlePluging('createAnswer', {
              jsep: x.payload.jsep,
              media: { audio: doAudio, video: doVideo },
              success: function (jsep) {
                console.log(
                  'Got SDP ' +
                    jsep.type +
                    '! audio=' +
                    doAudio +
                    ', video=' +
                    doVideo +
                    ':',
                  jsep
                );
                var body = { request: 'update' };
                clase.janusService.handlePluging('send', {
                  message: body,
                  jsep: jsep,
                });
              },
              error: function (error) {
                console.error('WebRTC error:', error);
              },
            });
          }
        }

        if (x.message === 'hangup') {
          clase.enLlamada = false;
          clase.entrante = false;

          clase.eventListener.emit({ ...x, ...{ type: 'hangup' } });
        }
      },
      (err) => console.error('Error: ', err),
      () => console.log('Observer Janus got a complete notification')
    );
  }

  llamar() {
    //console.log('esta llamando !!!!!!!!!!!!!!!!');
    //this.janusService.llamar('936715099');
  }

  // colgar() {
  //   this.janusService.colgar();
  // }

  contestar() {
    //console.log('Esta contestando!!!!!!!!!!!!!!!!!!!!');
    this.janusService.createAnswer(this.offerlessInvite, this.jsep);
    this.entrante = false;
  }

  statusUser(): string {
    if (!this.registered) return 'Desconectado';
    if (this.entrante) return 'LLamada entrante';
    if (this.enLlamada) return 'En llamada';
    if (this.registered) return 'Registrado';

    return '-';
  }
}
