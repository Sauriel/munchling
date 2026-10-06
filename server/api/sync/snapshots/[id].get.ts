import { getQuery, getRouterParam } from "h3";
import { getSnapshotPage } from "../../../services/read";
import { getServerDatabase } from "../../../database/runtime";
import { syncEndpoint } from "../../../utils/sync-http";
export default syncEndpoint((event) => {
	const query = getQuery(event);
	return getSnapshotPage(getServerDatabase(), query, getRouterParam(event, "id") || "", Number(query.page));
});
