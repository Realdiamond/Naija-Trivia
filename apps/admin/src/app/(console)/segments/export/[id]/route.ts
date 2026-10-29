/** An approved segment export as CSV (step 2.7o): only for the one who asked; the API logs it. */
import { NextResponse, type NextRequest } from 'next/server';
import { routes } from '@whosabi/shared-types';
import { AdminApiError, adminText } from '../../../../../lib/api';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const csv = await adminText(routes.admin.segmentExportDownload(id));
    return new NextResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="whosabi-segment-export-${id}.csv"`,
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
