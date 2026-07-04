import type { ReviewPacket } from "@securelore/review-core";
export interface SlackBlock {
    type: string;
    [key: string]: unknown;
}
export declare function renderReviewPacket(packet: ReviewPacket): SlackBlock[];
