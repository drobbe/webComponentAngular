import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';
import { HttpClientModule } from '@angular/common/http';
import { WebphoneComponent } from './webphone/webphone.component';
import { Injector } from '@angular/core';
import { createCustomElement } from '@angular/elements';

@NgModule({
  declarations: [WebphoneComponent],
  imports: [BrowserModule, HttpClientModule],
  providers: [],
  // bootstrap: [WebphoneComponent],
  entryComponents: [WebphoneComponent],
})
export class AppModule {
  constructor(private injector: Injector) {
    const el = createCustomElement(WebphoneComponent, { injector });
    customElements.define('news-widget', el);
  }
  ngDoBootstrap() {}
}
