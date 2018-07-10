import APICaller from "./api";
import { getComparativeCounts, getComparativeDurations } from "./utils";
import * as moment from "moment";

type Member = {
  login: string;
  avatar: string;
};

type Owner = {
  login: string;
  name: string;
  avatar: string;
};

type Repo = {
  name: string;
  description: string;
  is_private: boolean;
  is_fork: boolean;
  stargazers_count: number;
  updated_at: string;
};

// TODO(arjun): we can potentially add the reviewer
// and also the time taken to review
type RepoPR = {
  author: string;
  prs_opened: {
    previous: number;
    next: number;
  };
  prs_merged: {
    previous: number;
    next: number;
  };
  time_to_merge: {
    previous: number[];
    next: number[];
  };
};

type AuthorStats = {
  login: string;
  commits: {
    previous: number;
    next: number;
  };
  lines_added: {
    previous: number;
    next: number;
  };
  lines_deleted: {
    previous: number;
    next: number;
  };
};

type RepoStats = {
  is_pending: boolean;
  authors?: AuthorStats[];
};

export default class GithubService extends APICaller {
  report() {
    return Promise.all([this.repos(), this.members(), this.ownerInfo()])
      .then(values => {
        const repos = values[0];
        const members = values[1];
        const owner = values[2];
        return {
          period: { previous: this.periodPrev, next: this.periodNext },
          owner,
          members,
          repos
        };
      })
      .then(result => {
        const { repos } = result;
        const stats = repos.map(repo => this.statistics(repo.name));

        return Promise.all(stats).then(statsValues => {
          let repoResult = [];
          let index;

          for (index = 0; index < repos.length; index++) {
            repoResult.push({ ...repos[index], stats: statsValues[index] });
          }

          return { ...result, repos: repoResult };
        });
      })
      .then(result => {
        const { repos } = result;
        const pulls = repos.map(repo => this.pulls(repo.name));

        return Promise.all(pulls).then(pullsValues => {
          let repoResult = [];
          let index;

          for (index = 0; index < repos.length; index++) {
            repoResult.push({ ...repos[index], prs: pullsValues[index] });
          }

          return { ...result, repos: repoResult };
        });
      });
  }

  repos(): Promise<Repo[]> {
    // Doc: https://developer.github.com/v3/repos/#list-organization-repositories
    // We can also use https://api.github.com/installation/repositories
    // but that limits us to the organisations in the installation
    // TODO(arjun): this will not work for usernames
    const params = {
      path: `orgs/${this.owner}/repos`
      // These qs will work for the https://developer.github.com/v3/repos/#list-user-repositories
      // However, that API does not return private repos for orgs
      // qs: {
      //   sort: "updated",
      //   direction: "desc"
      // }
    };
    return this.getAllPages([], params).then(repos =>
      repos
        .filter(repo => moment(repo.updated_at) > this.periodPrev)
        .map(repo => ({
          name: repo.name,
          description: repo.description,
          is_private: repo.private,
          is_fork: repo.fork,
          stargazers_count: repo.stargazers_count,
          updated_at: repo.updated_at
        }))
    );
  }

  members(): Promise<Member[]> {
    // Doc: https://developer.github.com/v3/orgs/members/#members-list
    // TODO(arjun): this will not work for usernames
    const params = {
      path: `orgs/${this.owner}/members`
    };
    return this.getAllPages([], params).then(members => {
      return members.map(member => ({
        login: member.login,
        avatar: member.avatar_url
      }));
    });
  }

  ownerInfo(): Promise<Owner> {
    return this.get({
      path: `users/${this.owner}`,
      headers: {},
      qs: {}
    }).then(response => {
      const { login, name, avatar_url } = response.body;
      return { login, name, avatar: avatar_url };
    });
  }

  statistics(repo: string): Promise<RepoStats> {
    return this.get({
      path: `repos/${this.owner}/${repo}/stats/contributors`,
      headers: {},
      qs: {}
    }).then(response => {
      const { statusCode } = response;
      const { body } = response;

      if (statusCode === 202) {
        return { is_pending: true };
      } else if (statusCode === 204) {
        return { is_pending: false, authors: [] };
      } else if (statusCode === 200) {
        const authors = body
          .map(result => {
            const periodPrev = this.periodPrev.unix();
            const periodNext = this.periodNext.unix();
            const prevWeek = result.weeks.filter(data => data.w === periodPrev);
            const nextWeek = result.weeks.filter(data => data.w === periodNext);
            return {
              login: result.author.login,
              commits: {
                previous: prevWeek.length === 1 ? prevWeek[0].c : 0,
                next: nextWeek.length === 1 ? nextWeek[0].c : 0
              },
              lines_added: {
                previous: prevWeek.length === 1 ? prevWeek[0].a : 0,
                next: nextWeek.length === 1 ? nextWeek[0].a : 0
              },
              lines_deleted: {
                previous: prevWeek.length === 1 ? prevWeek[0].d : 0,
                next: nextWeek.length === 1 ? nextWeek[0].d : 0
              }
            };
          })
          .filter(
            author =>
              author.commits && (author.commits.next || author.commits.previous)
          );
        return { is_pending: false, authors };
      }
    });
  }

  pulls(repo: string): Promise<RepoPR[]> {
    const params = {
      path: `repos/${this.owner}/${repo}/pulls`,
      qs: {
        state: "all",
        sort: "updated",
        direction: "desc",
        per_page: 50 // overriding because 100 seems too much for one repo
      }
    };
    return this.getAllForDesc([], params, "updated_at").then(pulls => {
      let authorWisePRs = {};
      pulls.forEach(pull => {
        const author = pull.user.login;
        if (author in authorWisePRs) {
          authorWisePRs[author] = [...authorWisePRs[author], pull];
        } else {
          authorWisePRs[author] = [pull];
        }
      });
      const result = Object.keys(authorWisePRs).map(author => ({
        author,
        prs_opened: getComparativeCounts(authorWisePRs[author], "created_at"),
        prs_merged: getComparativeCounts(authorWisePRs[author], "merged_at"),
        time_to_merge: getComparativeDurations(
          authorWisePRs[author],
          "merged_at",
          "created_at"
        )
      }));
      return result;
    });
  }

  issues(repo: string) {
    // TODO(arjun): this can be used for both issues and PRs, which means we cannot
    // differentiate between a closed PR and a merged PR
    const params = {
      path: `repos/${this.owner}/${repo}/issues`,
      qs: {
        state: "all",
        since: this.periodPrev.toISOString()
      }
    };
    return this.getAllPages([], params).then(response => {
      const filtered = response.filter(issue => !issue.pull_request);
      return {
        name: "issues_created",
        values: getComparativeCounts(filtered, "created_at")
      };
    });
  }

  stargazers(repo: string) {
    // This doesn't work for repos that have >40,000 stars because
    // API returns only 400 pages (100 records per page)
    const params = {
      path: `repos/${this.owner}/${repo}/stargazers`,
      headers: { Accept: "application/vnd.github.v3.star+json" },
      qs: {}
    };
    return this.getAllForAsc(params, "starred_at").then(response => {
      return getComparativeCounts(response, "starred_at");
    });
  }
}
