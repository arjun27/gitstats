import * as React from "react";
import { Row } from "reactstrap";
import { TextColWrapper, ValueColWrapper } from "../common";

interface IValueDataPoint {
  next: number | string;
  previous: number | string;
  chartData?: IWeekValues[];
}

interface ISummaryProps {
  commits: IValueDataPoint;
  prsOpened: IValueDataPoint;
  prsMerged: IValueDataPoint;
  prComments: IValueDataPoint;
  activeRepos: IValueDataPoint;
  activeMembers: IValueDataPoint;
  isLoading: boolean;
}

export const SummaryRow: React.SFC<ISummaryProps> = ({
  commits,
  prsOpened,
  prsMerged,
  prComments,
  activeRepos,
  activeMembers,
  isLoading
}) => {
  return (
    <div className="my-2">
      <Row>
        <ValueColWrapper {...commits} title={"Commits"} />
        <ValueColWrapper {...prsOpened} title={"PRs opened"} />
        <ValueColWrapper {...prsMerged} title={"PRs merged"} />
        <ValueColWrapper {...prComments} title={"PR Comments"} />
      </Row>
      <Row>
        <TextColWrapper {...activeRepos} title={"Most Active Repo"} />
        <TextColWrapper {...activeMembers} title={"Most Active Member"} />
      </Row>
    </div>
  );
};