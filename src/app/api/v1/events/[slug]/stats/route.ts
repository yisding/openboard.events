import { corsPreflight, privateApiUnavailable } from "../../../_lib";

export function OPTIONS() { return corsPreflight(); }

export async function GET() {
  return privateApiUnavailable();
}
