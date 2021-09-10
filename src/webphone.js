class WebPhone {
  constructor(
    Server,
    User,
    Password,
    AuthUser,
    DisplayName,
    JanusServer,
    Element
  ) {
    this.Server = Server;
    this.User = User;
    this.Password = Password;
    this.AuthUser = AuthUser;
    this.DisplayName = DisplayName;
    this.JanusServer = JanusServer;
    this.Element = Element;
  }

  Init(callback) {
    sessionStorage.setItem("Server", this.Server);
    sessionStorage.setItem("User", this.User);
    sessionStorage.setItem("Password", this.Password);
    sessionStorage.setItem("AuthUser", this.AuthUser);
    sessionStorage.setItem("DisplayName", this.AuthUser);
    sessionStorage.setItem("JanusServer", this.JanusServer);

    this.Element.insertAdjacentHTML(
      "beforeend",
      "<news-widget id='web-component'></news-widget> "
    );
    const component = document.getElementById("web-component");
    console.log(callback);
    component.addEventListener("event-listener", (msg) => {
      const event = msg.detail;

      switch (event.type) {
        case "remote stream":
          callback.remote_stream(this._handlerMessager(event));
          break;
        case "error":
          callback.error(this._handlerMessager(event));
          break;
        case "registration_failed":
          callback.registration_failed(this._handlerMessager(event));
          break;
        case "registered":
          callback.registered(this._handlerMessager(event));
          break;
        case "calling":
          callback.calling(this._handlerMessager(event));
          break;
        case "incoming":
          callback.incoming(this._handlerMessager(event));
          break;
        case "progress":
          callback.progress(this._handlerMessager(event));
          break;
        case "accepted":
          callback.accepted(this._handlerMessager(event));
          break;
        case "updating":
          callback.updating(this._handlerMessager(event));
          break;
        case "hangup":
          callback.hangup(this._handlerMessager(event));
          break;
        case "incoming call":
          callback.hangup(this._handlerMessager(event));
          break;
        default:
          callback.error({ messagge: "Evento no reconocido", ...event });
          break;
      }
    });
  }

  _handlerMessager(event) {
    if (event.payload) {
      if (event.payload.result) {
        return { ...event.payload.result, ...{ type: event.type } };
      } else {
        return { ...event.messagge, ...{ type: event.type } };
      }
    }

    return event;
  }
}
