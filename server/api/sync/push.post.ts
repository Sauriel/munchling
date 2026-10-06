import { writeServerBatch } from "../../services/write";
import { getServerDatabase } from "../../database/runtime";
import { syncEndpoint, syncJsonBody } from "../../utils/sync-http";
export default syncEndpoint(async (event) => writeServerBatch(getServerDatabase(), await syncJsonBody(event)));
