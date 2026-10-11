import { getHeader } from 'h3';
import { writeServerBatch } from "../../services/write";
import { getServerDatabase } from "../../database/runtime";
import { syncEndpoint, syncJsonBody } from "../../utils/sync-http";
export default syncEndpoint(async (event) => writeServerBatch(getServerDatabase(), await syncJsonBody(event),Number(getHeader(event,'x-munchling-schema') ?? 0)));
