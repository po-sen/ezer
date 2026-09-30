-- Destructive baseline reversal. Recovery requires a separately verified backup.
-- Never executed by the Worker or an RPC endpoint.
DROP TABLE operations;
DROP TABLE revisions;
DROP TABLE state;
