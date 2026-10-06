import { getQuery } from "h3";
import type { SyncAggregate } from "../../../shared/domain/sync";
import { readDeletionPreview } from "../../services/read";
import { getServerDatabase } from "../../database/runtime";
import { syncEndpoint } from "../../utils/sync-http";
export default syncEndpoint((event) => {
	const query = getQuery(event);
	return readDeletionPreview(getServerDatabase(), query, String(query.entity) as SyncAggregate, String(query.id));
});
