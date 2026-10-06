import { getQuery, getRouterParam } from "h3";
import { releaseServerSnapshot } from "../../../services/read";
import { getServerDatabase } from "../../../database/runtime";
import { syncEndpoint } from "../../../utils/sync-http";
export default syncEndpoint((event) => releaseServerSnapshot(getServerDatabase(), getQuery(event), getRouterParam(event, "id") || ""));
