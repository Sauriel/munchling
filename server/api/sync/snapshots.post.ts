import { ServerProtocolError } from "../../../shared/domain/protocol";
import { createServerSnapshot } from "../../services/read";
import { getServerDatabase } from "../../database/runtime";
import { syncEndpoint, syncJsonBody } from "../../utils/sync-http";
export default syncEndpoint(async (event) => {
	const body = await syncJsonBody(event);
	if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["serverInstanceId", "serverEpoch", "targetBytes"].includes(key))) throw new ServerProtocolError("invalidRequest");
	return createServerSnapshot(getServerDatabase(), body, (body as { targetBytes?: number }).targetBytes);
});
