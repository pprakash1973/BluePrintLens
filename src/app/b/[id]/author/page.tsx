import { Author } from "@/components/Author";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Author id={id} />;
}
