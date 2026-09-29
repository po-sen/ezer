// Give cloudflare:workers exports the types of this Worker's entry point.
// Declaration merging only; this file emits no runtime code.
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("../index");
  }
}
