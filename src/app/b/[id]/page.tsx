import { Viewer } from "@/components/Viewer";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Viewer id={id} />;
}
