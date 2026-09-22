import type { Db } from './db.ts';
import type { SymbolicatorResponse } from './signature.ts';

function functionSearchText(response: SymbolicatorResponse): string {
    const names = new Set<string>();

    for (const trace of response.stacktraces ?? []) {
        for (const frame of trace.frames) {
            for (const name of [frame.function, frame.symbol]) {
                const normalized = name?.trim();
                if (normalized) {
                    names.add(normalized);
                }
            }
        }
    }

    return [...names].join('\n');
}

export function indexReportResponse(
    db: Db,
    reportId: string,
    response: SymbolicatorResponse,
): void {
    db.indexReportFunctions(reportId, functionSearchText(response));
}
