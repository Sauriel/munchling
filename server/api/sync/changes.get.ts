import { getQuery } from "h3";
import { readServerChanges } from "../../services/read";
import { getServerDatabase } from "../../database/runtime";
import { syncEndpoint } from "../../utils/sync-http";
export default syncEndpoint((event) => {
	const query = getQuery(event);
	return readServerChanges(getServerDatabase(), query, query.cursor, query.limit === undefined ? undefined : Number(query.limit), query.targetBytes === undefined ? undefined : Number(query.targetBytes));
});
