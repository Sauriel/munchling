import { getQuery } from "h3";
import { getServerDatabase } from "../../database/runtime";
import { readWebState } from "../../services/web";
import { syncEndpoint } from "../../utils/sync-http";
export default syncEndpoint(event => readWebState(getServerDatabase(), getQuery(event)));
