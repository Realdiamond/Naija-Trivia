/** A month's purchases as CSV for finance (step 2.7i); the API logs the export. */
import { NextResponse, type NextRequest } from 'next/server';
import { routes } from '@whosabi/shared-types';
import { AdminApiError, adminText } from '../../../../lib/api';

export async function GET(request: NextRequest) {
  const month = request.nextUrl.searchParams.get('month') ?? '';
  try {
    const csv = await adminText(routes.admin.commerceExport(month));
    return new NextResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="whosabi-purchases-${month}.csv"`,
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
