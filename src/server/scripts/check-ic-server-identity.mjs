import "dotenv/config";
import {
  getBackendActor,
  getIcpServerPrincipalText,
} from "../ic-backend.js";

const principal = getIcpServerPrincipalText();

if (!principal) {
  console.error(
    "Unable to derive the server principal. Set ICP_SERVER_IDENTITY_JSON in src/server/.env first.",
  );
  process.exit(1);
}

const configuredPrincipal = String(process.env.SERVER_PRINCIPAL || "").trim();
if (configuredPrincipal && configuredPrincipal !== principal) {
  console.error(
    "SERVER_PRINCIPAL does not match ICP_SERVER_IDENTITY_JSON. Update or remove the stale SERVER_PRINCIPAL value.",
  );
  process.exit(1);
}

console.log(`Server principal: ${principal}`);
console.log("");
console.log("CLI grant command (must be run by an existing app admin):");
console.log(
  `icp canister call -e ic backend assignCallerUserRole '(principal "${principal}", variant { admin })'`,
);
console.log("");

try {
  const actor = await getBackendActor();
  await actor.getTwilioLineNumbersForServer();
  console.log("Backend authorization: admin access confirmed.");
} catch (error) {
  const message = String(error?.message || error);
  const authorizationError =
    message.includes("User is not registered") ||
    message.includes("Unauthorized") ||
    message.includes("admin only");
  if (authorizationError) {
    console.error("Backend authorization: not authorized.");
    console.error(
      "Sign in to the app with the existing browser admin, open Admin > Users, and assign the principal above the Admin role.",
    );
  } else {
    console.error(
      "Backend authorization check failed because the backend could not be reached. Check BACKEND_HOST and network access, then retry.",
    );
  }
  process.exitCode = 1;
}
