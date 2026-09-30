export interface AccessTokenVerifier {
  verify(
    token: string,
    authority: {
      readonly issuer: string;
      readonly resource: string;
      readonly jwksUri: string;
    },
  ): Promise<
    { readonly subject: string; readonly scopes: readonly string[] } | undefined
  >;
}
