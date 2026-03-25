import RoomIdPage from "@/components/client/roomId-page";

type PageProps = {
  params: Promise<{
    roomId: string;
  }>;
};
const Page = async ({ params }: PageProps) => {
  const { roomId } = await params;
  return <RoomIdPage roomId={roomId}></RoomIdPage>;
};

export default Page;
