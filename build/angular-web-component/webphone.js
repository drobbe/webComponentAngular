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
    this.init = false;
  }

  Init() {
    if (this.init === true) {
      console.error("Webphone Inicializado!!");
      return;
    }
    this.init = true;
    sessionStorage.setItem("Server", this.Server);
    sessionStorage.setItem("User", this.User);
    sessionStorage.setItem("Password", this.Password);
    sessionStorage.setItem("AuthUser", this.AuthUser);
    sessionStorage.setItem("DisplayName", this.AuthUser);
    sessionStorage.setItem("JanusServer", this.JanusServer);

    this.Element.insertAdjacentHTML("beforeend", "<news-widget></news-widget>");
  }
}
