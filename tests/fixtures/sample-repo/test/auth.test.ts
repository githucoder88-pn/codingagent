import { authenticate, AuthService } from "../src/auth";

export function testAuthenticate() {
  return authenticate("bob", "pw");
}

export function testAuthService() {
  const service = new AuthService();
  service.add(authenticate("bob", "pw"));
  return service.count();
}
