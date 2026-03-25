import { useEffect } from "react";
import { Config } from "@/lib/config";
import { startOffer } from "@/lib/peer";
import RoomIdPage from "@/components/client/roomId-page";

type PageProps = {
  params: {
    roomId: string;
  };
};
const Page = ({ params }: PageProps) => {
  return <RoomIdPage roomId={params.roomId}></RoomIdPage>;
};

export default Page;
