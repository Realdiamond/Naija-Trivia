/** A dashboard's numbers as CSV (step 2.7r), with the same filters and a reason; the API logs it. */
import { NextResponse, type NextRequest } from 'next/server';
import { routes } from '@whosabi/shared-types';
import { AdminApiError, adminText } from '../../../../lib/api';

export async function GET(request: NextRequest) {
  const params = new URLSearchParams(request.nextUrl.searchParams);
  const board = params.get('board') ?? 'engagement';
  params.delete('board');
  try {
    const csv = await adminText(routes.admin.analyticsExport(board, params.toString()));
    return new NextResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="whosabi-${board.replace(/[^a-z]/g, '')}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof AdminApiError ? e.message : 'The export did not work.' },
      { status: e instanceof AdminApiError ? e.status : 500 },
    );
  }
}
