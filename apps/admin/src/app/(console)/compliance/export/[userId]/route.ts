/**
 * A player's data as a download for the DPO (step 2.8a). The reason comes with the link and the
 * API logs it before anything leaves.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { routes } from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../../../lib/api';

export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const reason = request.nextUrl.searchParams.get('reason') ?? '';
  try {
    const data = await adminApi<unknown>(routes.admin.userExport(userId), {
      method: 'POST',
      body: { reason },
    });
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'content-type': 'application/json',
        'content-disposition': `attachment; filename="whosabi-${userId}.json"`,
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
