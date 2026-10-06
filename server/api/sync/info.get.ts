import { serverInfo } from "../../services/read";
import { getServerDatabase } from "../../database/runtime";
import { syncEndpoint } from "../../utils/sync-http";
export default syncEndpoint(() => serverInfo(getServerDatabase()), false);
